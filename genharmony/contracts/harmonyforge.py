# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
import hashlib

APPROVAL_THRESHOLD = 55
SCORE_TOLERANCE     = 10   # max allowed gap between leader's and a validator's
                            # independently-judged score, checked PER AXIS
MIN_SHARED_TERMS    = 3    # min significant terms evolved_content must share
                            # with (track content + contribution) to be accepted
MIN_CONTENT_OVERLAP_RATIO = 0.75  # min fraction of significant terms the leader's
                                   # evolved_content must share with a validator's
                                   # own independently re-derived evolved_content
MAX_REWARD_BPS    = u256(1000)
BPS_DENOMINATOR   = u256(10000)
MIN_REWARD_WEI    = u256(10_000_000_000_000_000)


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass
    class Write:
        pass


class HarmonyForge(gl.Contract):
    owner: Address
    next_track_id:    u256
    next_proposal_id: u256
    next_element_id:  u256
    treasury_locked:  u256
    pending_rewards:    TreeMap[Address, u256]
    contribution_count: TreeMap[Address, u256]
    tracks:          TreeMap[str, str]
    proposals:       TreeMap[str, str]
    minted_elements: TreeMap[str, str]

    def __init__(self):
        self.owner            = gl.message.sender_address
        self.next_track_id    = u256(0)
        self.next_proposal_id = u256(0)
        self.next_element_id  = u256(0)
        self.treasury_locked  = u256(0)

    # ------------------------------------------------------------------
    # Track lifecycle
    # ------------------------------------------------------------------
    @gl.public.write
    def submit_seed(self, title: str, seed_prompt: str, genre: str) -> str:
        """Create a new track from a musical seed prompt."""
        if not seed_prompt.strip():
            raise gl.vm.UserError("seed_prompt cannot be empty")
        track_id = str(self.next_track_id)
        self.next_track_id = self.next_track_id + u256(1)
        track = {
            "id": track_id, "title": title, "genre": genre,
            "creator": str(gl.message.sender_address), "status": "active",
            "current_content": seed_prompt, "version": 0, "parent_track_id": None,
        }
        self.tracks[track_id] = json.dumps(track)
        self.contribution_count[gl.message.sender_address] = (
            self.contribution_count.get(gl.message.sender_address, u256(0)) + u256(1)
        )
        return track_id

    @gl.public.write
    def fork_track(self, parent_track_id: str, new_title: str) -> str:
        """Create a new independent track by forking an existing one."""
        raw = self.tracks.get(parent_track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"unknown track_id: {parent_track_id}")
        parent = json.loads(raw)
        track_id = str(self.next_track_id)
        self.next_track_id = self.next_track_id + u256(1)
        self.tracks[track_id] = json.dumps({
            "id": track_id, "title": new_title, "genre": parent["genre"],
            "creator": str(gl.message.sender_address), "status": "active",
            "current_content": parent["current_content"], "version": 0,
            "parent_track_id": parent_track_id,
        })
        return track_id

    @gl.public.write
    def propose_evolution(self, track_id: str, target_element: str, musical_relationship: str, key_terms: str, contribution_type: str, audio_url: str = "", audio_hash: str = "") -> str:
        """Queue a remix/harmony/variation proposal for an active track, as a
        structured, content-addressed artifact rather than free text.

        target_element        — what part of the track this modifies
        musical_relationship  — the precise technical description of the change
        key_terms             — comma-separated explicit vocabulary anchoring
                                 the deterministic correspondence check below
        audio_url             — optional link to actual audio for this proposal
        audio_hash            — optional SHA-256 hex digest of that audio file's
                                 bytes, computed client-side (GenVM cannot process
                                 binary audio). Pinned into artifact_hash below so
                                 the referenced audio can't be silently swapped
                                 after submission. NOTE: this is an integrity
                                 check only — it confirms which audio file is
                                 being referenced, not that the audio itself
                                 musically corresponds to target_element/
                                 musical_relationship/key_terms. The jury has no
                                 ability to listen to or analyze audio content;
                                 correspondence, provenance, and originality
                                 judgments remain based on the text fields alone.
        """
        raw = self.tracks.get(track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"unknown track_id: {track_id}")
        if json.loads(raw)["status"] != "active":
            raise gl.vm.UserError(f"track {track_id} is not active")
        if not target_element.strip() or not musical_relationship.strip() or not key_terms.strip():
            raise gl.vm.UserError("target_element, musical_relationship, and key_terms cannot be empty")
        if bool(audio_url.strip()) != bool(audio_hash.strip()):
            raise gl.vm.UserError("audio_url and audio_hash must both be provided, or both left empty")
        proposal_id = str(self.next_proposal_id)
        self.next_proposal_id = self.next_proposal_id + u256(1)
        artifact_hash = hashlib.sha256(
            f"{target_element}|{musical_relationship}|{key_terms}|{audio_hash}".encode()
        ).hexdigest()
        self.proposals[proposal_id] = json.dumps({
            "id": proposal_id, "track_id": track_id,
            "proposer": str(gl.message.sender_address),
            "target_element": target_element,
            "musical_relationship": musical_relationship,
            "key_terms": key_terms,
            "audio_url": audio_url,
            "audio_hash": audio_hash,
            "artifact_hash": artifact_hash,
            "contribution_type": contribution_type,
            "status": "pending", "scores": None,
            "evolved_content": None, "rationale": None,
            "track_version": json.loads(raw)["version"],
        })
        return proposal_id

    # ------------------------------------------------------------------
    # LLM-powered evaluation & consensus
    # ------------------------------------------------------------------
    @gl.public.write
    def evaluate_proposal(self, proposal_id: str) -> str:
        """Run the LLM jury on a proposal and merge it into canon if approved."""
        raw_proposal = self.proposals.get(proposal_id, None)
        if raw_proposal is None:
            raise gl.vm.UserError(f"unknown proposal_id: {proposal_id}")
        proposal = json.loads(raw_proposal)
        if proposal["status"] != "pending":
            raise gl.vm.UserError(f"proposal {proposal_id} already evaluated")

        raw_track = self.tracks.get(proposal["track_id"], None)
        if raw_track is None:
            raise gl.vm.UserError("track no longer exists")
        track = json.loads(raw_track)

        if track["version"] != proposal.get("track_version"):
            proposal["status"]    = "stale"
            proposal["rationale"] = (
                f"track advanced to version {track['version']} after this proposal "
                f"was submitted against version {proposal.get('track_version')} — "
                f"resubmit against the current canon content"
            )
            self.proposals[proposal_id] = json.dumps(proposal)
            return json.dumps({
                "proposal_id": proposal_id,
                "status": "stale",
                "current_track_version": track["version"],
                "proposal_track_version": proposal.get("track_version"),
            })

        verdict = self._judge_evolution(track, proposal)
        composite = (verdict["originality"] + verdict["quality"] +
                     verdict["emotional"] + verdict["canon_fit"]) // 4

        if (not verdict["approve"]) or composite < APPROVAL_THRESHOLD:
            proposal["status"]    = "rejected"
            proposal["scores"]    = verdict
            proposal["rationale"] = verdict["rationale"]
            self.proposals[proposal_id] = json.dumps(proposal)
            return json.dumps({
                "proposal_id": proposal_id,
                "status": "rejected",
                "composite_score": composite,
            })

        track["current_content"] = verdict["evolved_content"]
        track["version"]         = track["version"] + 1
        self.tracks[track["id"]] = json.dumps(track)

        proposal["status"]          = "approved"
        proposal["scores"]          = verdict
        proposal["evolved_content"] = verdict["evolved_content"]
        proposal["rationale"]       = verdict["rationale"]
        self.proposals[proposal_id] = json.dumps(proposal)

        contributor_addr = Address(proposal["proposer"])
        self.contribution_count[contributor_addr] = (
            self.contribution_count.get(contributor_addr, u256(0)) + u256(1)
        )
        reward = self._calculate_reward(composite)
        if reward > u256(0):
            self.pending_rewards[contributor_addr] = (
                self.pending_rewards.get(contributor_addr, u256(0)) + reward
            )
            self.treasury_locked = self.treasury_locked + reward

        return json.dumps({
            "proposal_id": proposal_id,
            "status": "approved",
            "composite_score": composite,
            "new_version": track["version"],
            "reward_credited": str(reward),
            "credited_to": str(contributor_addr),
        })

    # ------------------------------------------------------------------
    # Treasury & rewards
    # ------------------------------------------------------------------
    @gl.public.write.payable
    def fund_treasury(self) -> str:
        """Anyone can add GEN to the shared reward pool."""
        if gl.message.value == u256(0):
            raise gl.vm.UserError("send GEN with this call to fund the treasury")
        return f"treasury funded with {gl.message.value} wei"

    @gl.public.write
    def claim_rewards(self) -> str:
        """Claim pending rewards (pull payment pattern)."""
        claimant = gl.message.sender_address
        amount   = self.pending_rewards.get(claimant, u256(0))
        if amount == u256(0):
            raise gl.vm.UserError("no pending rewards to claim")
        if self.balance < amount:
            raise gl.vm.UserError("treasury balance temporarily insufficient")
        _Recipient(claimant).emit_transfer(value=amount)
        self.pending_rewards[claimant] = u256(0)
        self.treasury_locked = (
            self.treasury_locked - amount if self.treasury_locked >= amount else u256(0)
        )
        return f"transferred {amount} wei to {claimant}"

    # ------------------------------------------------------------------
    # Minting
    # ------------------------------------------------------------------
    @gl.public.write.payable
    def mint_element(self, track_id: str, kind: str) -> str:
        """Mint a track element as an owned, provenance-tracked record."""
        raw = self.tracks.get(track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"unknown track_id: {track_id}")
        if gl.message.value == u256(0):
            raise gl.vm.UserError("send GEN with this call to mint an element")
        element_id = str(self.next_element_id)
        self.next_element_id = self.next_element_id + u256(1)
        self.minted_elements[element_id] = json.dumps({
            "id": element_id, "track_id": track_id, "kind": kind,
            "owner": str(gl.message.sender_address),
            "version_at_mint": json.loads(raw)["version"],
        })
        return element_id

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------
    @gl.public.view
    def get_track(self, track_id: str) -> str:
        """Look up a track record by its id."""
        raw = self.tracks.get(track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"track {track_id} not found")
        return raw

    @gl.public.view
    def get_proposal(self, proposal_id: str) -> str:
        """Look up a proposal record by its id."""
        raw = self.proposals.get(proposal_id, None)
        if raw is None:
            raise gl.vm.UserError(f"proposal {proposal_id} not found")
        return raw

    @gl.public.view
    def list_active_tracks(self) -> DynArray[str]:
        """Return list of track IDs whose status is active."""
        result = []
        i = u256(0)
        while i < self.next_track_id:
            track_id = str(i)
            raw = self.tracks.get(track_id, None)
            if raw is not None and json.loads(raw).get("status") == "active":
                result.append(track_id)
            i = i + u256(1)
        return result

    @gl.public.view
    def get_top_tracks(self, limit: str) -> DynArray[str]:
        """Return active track ids ranked by version (most-evolved first)."""
        entries = []
        i = u256(0)
        while i < self.next_track_id:
            track_id = str(i)
            raw = self.tracks.get(track_id, None)
            if raw is not None:
                t = json.loads(raw)
                if t.get("status") == "active":
                    entries.append((track_id, t.get("version", 0)))
            i = i + u256(1)
        entries.sort(key=lambda e: e[1], reverse=True)
        try:
            n = int(limit)
        except Exception:
            n = 10
        return [e[0] for e in entries[:n]]

    @gl.public.view
    def get_my_tracks(self, address: str) -> DynArray[str]:
        """Return active track ids created by the given address."""
        result = []
        i = u256(0)
        while i < self.next_track_id:
            track_id = str(i)
            raw = self.tracks.get(track_id, None)
            if raw is not None:
                t = json.loads(raw)
                if t.get("status") == "active" and t.get("creator") == address:
                    result.append(track_id)
            i = i + u256(1)
        return result

    @gl.public.view
    def get_tracks_by_genre(self, genre: str) -> DynArray[str]:
        """Return active track ids whose genre contains the given text (case-insensitive)."""
        needle = genre.strip().lower()
        result = []
        i = u256(0)
        while i < self.next_track_id:
            track_id = str(i)
            raw = self.tracks.get(track_id, None)
            if raw is not None:
                t = json.loads(raw)
                if t.get("status") == "active" and needle in t.get("genre", "").lower():
                    result.append(track_id)
            i = i + u256(1)
        return result

    @gl.public.view
    def get_pending_rewards(self, address: str) -> u256:
        """Claimable GEN balance for the given address."""
        return self.pending_rewards.get(Address(address), u256(0))

    @gl.public.view
    def get_treasury_balance(self) -> u256:
        """Total GEN currently held by the contract."""
        return self.balance

    @gl.public.view
    def get_contribution_count(self, address: str) -> u256:
        """Number of approved contributions for the given address."""
        return self.contribution_count.get(Address(address), u256(0))

    @gl.public.view
    def get_minted_element(self, element_id: str) -> str:
        """Look up a minted element record by its id."""
        raw = self.minted_elements.get(element_id, None)
        if raw is None:
            raise gl.vm.UserError(f"element {element_id} not found")
        return raw

    @gl.public.view
    def get_my_minted_elements(self) -> DynArray[str]:
        """Return the ids of all minted elements owned by the caller.

        NOTE: relies on gl.message.sender_address inside a view call, which
        may not reliably reflect the actual contributor when called via a
        read (no signer attached). Kept as-is for compatibility with the
        existing deployed interface; consider migrating to an explicit
        address parameter (matching get_my_tracks) in a future revision.
        """
        caller = str(gl.message.sender_address)
        result = []
        i = u256(0)
        while i < self.next_element_id:
            element_id = str(i)
            raw = self.minted_elements.get(element_id, None)
            if raw is not None and json.loads(raw).get("owner") == caller:
                result.append(element_id)
            i = i + u256(1)
        return result

    @gl.public.view
    def get_next_proposal_id(self) -> str:
        """Return the id that WOULD be assigned to the next proposal, as of
        this read. NOT safe to treat as the id of a proposal you're about to
        submit — another proposal can land first. Always use the id returned
        by propose_evolution's own transaction receipt instead."""
        return str(self.next_proposal_id)

    # ------------------------------------------------------------------
    # Internal: treasury accounting
    # ------------------------------------------------------------------
    def _available_treasury(self) -> u256:
        bal = self.balance
        return u256(0) if bal <= self.treasury_locked else bal - self.treasury_locked

    def _calculate_reward(self, composite_score: int) -> u256:
        available = self._available_treasury()
        if available == u256(0):
            return u256(0)
        capped    = max(0, min(100, composite_score))
        score_sq  = u256(capped * capped)
        max_slice = (available * MAX_REWARD_BPS) // BPS_DENOMINATOR
        reward    = (max_slice * score_sq) // u256(10000)
        if reward > max_slice:
            reward = max_slice
        if reward < MIN_REWARD_WEI:
            reward = MIN_REWARD_WEI if available >= MIN_REWARD_WEI else available
        return reward

    # ------------------------------------------------------------------
    # Internal: nondet LLM jury
    # ------------------------------------------------------------------
    def _fetch_web_context(self, url: str = "") -> str:
        if not url:
            return ""
        try:
            return gl.nondet.web.render(url, mode="text")[:2000]
        except Exception:
            return ""

    def _build_prompt(self, track: dict, proposal: dict, context: str) -> str:
        return f"""You are one of several independent jurors evaluating a proposed music evolution.
Judge on artistic merit alone — do not soften or inflate scores to be agreeable.

TRACK TITLE: {track['title']}
GENRE: {track['genre']}
CURRENT CANON CONTENT: {track['current_content']}
CONTRIBUTION TYPE: {proposal['contribution_type']}
TARGET ELEMENT: {proposal['target_element']}
MUSICAL RELATIONSHIP: {proposal['musical_relationship']}
KEY TERMS: {proposal['key_terms']}
AUDIO REFERENCE: {"a file is referenced (hash: " + proposal['audio_hash'][:12] + "...) but you cannot access, play, or analyze it" if proposal.get('audio_hash') else "none provided"}
WEB CONTEXT: {context}

Score honestly. A generic, low-effort, or filler contribution should score low.
A genuinely original, well-crafted contribution should score high.
Check that evolved_content and your scores genuinely correspond to the KEY
TERMS above — a proposal whose merged content ignores or contradicts its own
stated key terms should not be approved on the strength of its framing alone.
The presence of an AUDIO REFERENCE is NOT evidence of quality, originality, or
correspondence by itself — you have no way to hear it, so judge the proposal
exactly as you would judge one with no audio reference at all: on the text
fields above alone.
If you approve, evolved_content must be the CURRENT CANON CONTENT genuinely
merged with the MUSICAL RELATIONSHIP described above — not a rewrite from
scratch, and not unrelated text.

Return ONLY a JSON object with keys:
- "approve": boolean — your independent judgment on whether this should be merged
- "quality": integer 0-100
- "originality": integer 0-100
- "emotional": integer 0-100
- "canon_fit": integer 0-100
- "evolved_content": string (merged content if you'd approve, else "")
- "rationale": string (<= 280 chars)"""

    def _shares_derivation(self, evolved_content: str, track_content: str, contribution_text: str) -> bool:
        """
        Deterministic, non-LLM sanity check that evolved_content actually
        derives from the track's existing canon and the proposed contribution,
        rather than being fabricated or unrelated text. Tolerant of paraphrase
        and creative rewording — only checks for a minimum number of shared
        significant (4+ letter) terms, not exact phrasing.
        """
        def significant_terms(s: str) -> set:
            return {w.lower() for w in s.split() if len(w) >= 4}

        evolved_terms = significant_terms(evolved_content)
        if not evolved_terms:
            return False

        base_terms = significant_terms(track_content) | significant_terms(contribution_text)
        if not base_terms:
            return True  # nothing to compare against — don't false-fail

        return len(evolved_terms & base_terms) >= MIN_SHARED_TERMS

    def _content_matches(self, a: str, b: str, min_ratio: float) -> bool:
        """
        Deterministic, non-LLM overlap check between two independently
        produced content strings. Binds the leader's proposed canon content
        to what a validator's own independent LLM run produced for the
        identical prompt.
        """
        def significant_terms(s: str) -> set:
            return {w.lower() for w in s.split() if len(w) >= 4}

        terms_a = significant_terms(a)
        terms_b = significant_terms(b)
        if not terms_a or not terms_b:
            return False

        overlap = len(terms_a & terms_b)
        smaller = min(len(terms_a), len(terms_b))
        return (overlap / smaller) >= min_ratio

    def _content_equivalent(self, a: str, b: str, track: dict, proposal: dict) -> bool:
        """
        Semantic fallback for when _content_matches fails on lexical grounds.
        Two independently-generated creative merges of the same inputs can be
        substantively the same evolution while sharing almost no vocabulary
        (paraphrase, reordering, synonym choice). This asks an LLM juror to
        judge equivalence directly, rather than penalizing wording variance
        that a strict-eq or term-overlap check can't distinguish from a
        genuinely different outcome.
        """
        equivalence_prompt = f"""You are comparing two independently-produced merges of the
same canon content with the same proposed contribution. Judge ONLY whether
they represent the SAME substantive creative evolution — same core ideas,
same structural change to the canon — allowing for paraphrase, reordering,
and different word choice. Wording differences alone do NOT make them
non-equivalent. A genuinely different creative direction, added or missing
content, or a different interpretation of the contribution DOES make them
non-equivalent.

ORIGINAL CANON CONTENT: {track['current_content']}
TARGET ELEMENT: {proposal['target_element']}
MUSICAL RELATIONSHIP: {proposal['musical_relationship']}
KEY TERMS: {proposal['key_terms']}

MERGE A: {a}

MERGE B: {b}

Return ONLY a JSON object: {{"equivalent": boolean, "reason": string (<=200 chars)}}"""

        try:
            result = gl.nondet.exec_prompt(equivalence_prompt, response_format="json")
        except Exception:
            return False
        if not isinstance(result, dict) or not isinstance(result.get("equivalent"), bool):
            return False
        return result["equivalent"]

    def _judge_evolution(self, track: dict, proposal: dict) -> dict:
        genre   = track.get("genre", "")
        url     = ("https://en.wikipedia.org/wiki/" + genre.strip().replace(" ", "_")) if genre else ""
        context = self._fetch_web_context(url)
        prompt  = self._build_prompt(track, proposal, context)

        def leader_fn():
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(result, dict):
                raise gl.vm.UserError("leader returned non-dict")
            required = ("approve", "quality", "originality", "emotional", "canon_fit", "evolved_content", "rationale")
            for k in required:
                if k not in result:
                    raise gl.vm.UserError(f"leader response missing key: {k}")
            return result

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            d = leader_result.calldata
            if not isinstance(d, dict):
                return False

            # --- Structural checks ---
            score_keys = ("quality", "originality", "emotional", "canon_fit")
            if not isinstance(d.get("approve"), bool):
                return False
            for k in score_keys:
                if not isinstance(d.get(k), int) or not (0 <= d[k] <= 100):
                    return False
            if not isinstance(d.get("evolved_content"), str) or not isinstance(d.get("rationale"), str):
                return False

            # --- Independent re-judgment: decision + per-score integrity ---
            try:
                own = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception:
                return False
            if not isinstance(own, dict) or not isinstance(own.get("approve"), bool):
                return False
            for k in score_keys:
                if not isinstance(own.get(k), int) or not (0 <= own[k] <= 100):
                    return False
            if not isinstance(own.get("evolved_content"), str):
                return False

            if own["approve"] != d["approve"]:
                return False

            # Each reward-driving score individually, not just the composite
            # average — a wide average can mask sharp disagreement on one
            # or more individual dimensions.
            for k in score_keys:
                if abs(own[k] - d[k]) > SCORE_TOLERANCE:
                    return False

            # --- Content integrity: guards what actually becomes canon ---
            if d["approve"]:
                evolved = d["evolved_content"].strip()
                if not evolved:
                    return False
                if evolved == track["current_content"].strip():
                    return False  # must actually change something
                proposal_terms = f"{proposal['target_element']} {proposal['musical_relationship']} {proposal['key_terms']}"
                if not self._shares_derivation(evolved, track["current_content"], proposal_terms):
                    return False  # content must derive from real inputs, not be fabricated
                if not self._content_matches(evolved, own["evolved_content"].strip(), MIN_CONTENT_OVERLAP_RATIO):
                    # lexical fast-path failed — before rejecting, check whether the
                    # two merges are substantively the same evolution just phrased
                    # differently, rather than treating wording variance as divergence
                    if not self._content_equivalent(evolved, own["evolved_content"].strip(), track, proposal):
                        return False  # leader's proposed canon must substantively match what the
                                      # validator itself independently derived, lexically or semantically

            return True

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
