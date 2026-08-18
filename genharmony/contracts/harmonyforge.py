# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

# ---------------------------------------------------------------------------
# Default constants (all owner-updatable via update_config)
# ---------------------------------------------------------------------------
DEFAULT_APPROVAL_THRESHOLD  = u256(50)
DEFAULT_MAX_REWARD_BPS      = u256(1000)
DEFAULT_MIN_REWARD_SCORE    = u256(50)
DEFAULT_MAX_PROMPT_CHARS    = u256(2000)
DEFAULT_CREATOR_ROYALTY_BPS = u256(4000)
BPS_DENOMINATOR             = u256(10000)
MIN_REWARD_WEI              = u256(10_000_000_000_000_000)
SCORE_TOLERANCE             = 20
MAX_TOP_TRACKS              = 50


class HarmonyForge(gl.Contract):
    owner: Address
    approval_threshold:  u256
    max_reward_bps:      u256
    min_reward_score:    u256
    max_prompt_chars:    u256
    creator_royalty_bps: u256
    is_paused:           u256
    next_track_id:       u256
    next_proposal_id:    u256
    next_element_id:     u256
    next_event_id:       u256
    treasury_locked:     u256
    pending_rewards:     TreeMap[Address, u256]
    contribution_count:  TreeMap[Address, u256]
    tracks:              TreeMap[str, str]
    proposals:           TreeMap[str, str]
    minted_elements:     TreeMap[str, str]
    events:              TreeMap[str, str]

    def __init__(self):
        self.owner               = gl.message.sender_address
        self.approval_threshold  = DEFAULT_APPROVAL_THRESHOLD
        self.max_reward_bps      = DEFAULT_MAX_REWARD_BPS
        self.min_reward_score    = DEFAULT_MIN_REWARD_SCORE
        self.max_prompt_chars    = DEFAULT_MAX_PROMPT_CHARS
        self.creator_royalty_bps = DEFAULT_CREATOR_ROYALTY_BPS
        self.is_paused           = u256(0)
        self.next_track_id       = u256(0)
        self.next_proposal_id    = u256(0)
        self.next_element_id     = u256(0)
        self.next_event_id       = u256(0)
        self.treasury_locked     = u256(0)

    @gl.public.write
    def pause(self) -> str:
        self._require_owner()
        self.is_paused = u256(1)
        self._emit("PAUSED", {})
        return "contract paused"

    @gl.public.write
    def unpause(self) -> str:
        self._require_owner()
        self.is_paused = u256(0)
        self._emit("UNPAUSED", {})
        return "contract unpaused"

    @gl.public.write
    def update_config(self, key: str, value: u256) -> str:
        self._require_owner()
        allowed = {"approval_threshold","max_reward_bps","min_reward_score","max_prompt_chars","creator_royalty_bps"}
        if key not in allowed:
            raise gl.vm.UserError(f"unknown config key: {key}")
        if key == "approval_threshold":
            if value > u256(100): raise gl.vm.UserError("must be 0-100")
            self.approval_threshold = value
        elif key == "max_reward_bps":
            if value > u256(3000): raise gl.vm.UserError("capped at 3000")
            self.max_reward_bps = value
        elif key == "min_reward_score":
            self.min_reward_score = value
        elif key == "max_prompt_chars":
            if value < u256(100): raise gl.vm.UserError("must be >= 100")
            self.max_prompt_chars = value
        elif key == "creator_royalty_bps":
            if value > BPS_DENOMINATOR: raise gl.vm.UserError("cannot exceed 10000")
            self.creator_royalty_bps = value
        self._emit("CONFIG_UPDATED", {"key": key, "value": str(value)})
        return f"set {key}={value}"

    @gl.public.write
    def submit_seed(self, title: str, seed_prompt: str, genre: str) -> str:
        self._require_not_paused()
        self._validate_text(title, 200, "title")
        self._validate_text(seed_prompt, int(self.max_prompt_chars), "seed_prompt")
        self._validate_text(genre, 100, "genre")
        track_id = str(self.next_track_id)
        self.next_track_id = self.next_track_id + u256(1)
        creator = str(gl.message.sender_address)
        track = {
            "id": track_id, "title": title[:200], "genre": genre[:100],
            "creator": creator, "status": "active",
            "current_content": seed_prompt, "version": 0,
            "parent_track_id": None, "contributors": [creator],
            "audio_url": "",
            "history": [{"version":0,"contributor":creator,"proposal_id":None,"rationale":"genesis seed","scores":None}],
        }
        self.tracks[track_id] = json.dumps(track)
        self.contribution_count[gl.message.sender_address] = (
            self.contribution_count.get(gl.message.sender_address, u256(0)) + u256(1)
        )
        self._emit("TRACK_CREATED", {"track_id": track_id, "creator": creator, "genre": genre})
        return track_id

    @gl.public.write
    def fork_track(self, parent_track_id: str, new_title: str) -> str:
        self._require_not_paused()
        self._validate_text(new_title, 200, "new_title")
        raw = self.tracks.get(parent_track_id, None)
        if raw is None: raise gl.vm.UserError(f"unknown track_id: {parent_track_id}")
        parent = json.loads(raw)
        track_id = str(self.next_track_id)
        self.next_track_id = self.next_track_id + u256(1)
        forker = str(gl.message.sender_address)
        forked = {
            "id": track_id, "title": new_title[:200], "genre": parent["genre"],
            "creator": forker, "status": "active",
            "current_content": parent["current_content"], "version": 0,
            "parent_track_id": parent_track_id, "contributors": [forker],
            "audio_url": "",
            "history": [{"version":0,"contributor":forker,"proposal_id":None,"rationale":f"forked from track {parent_track_id} @v{parent['version']}","scores":None}],
        }
        self.tracks[track_id] = json.dumps(forked)
        self._emit("TRACK_FORKED", {"track_id": track_id, "parent": parent_track_id, "creator": forker})
        return track_id

    @gl.public.write
    def propose_evolution(self, track_id: str, contribution_text: str, contribution_type: str) -> str:
        self._require_not_paused()
        self._validate_text(contribution_text, int(self.max_prompt_chars), "contribution_text")
        allowed_types = {"harmony","remix","lyric","melody","structure","arrangement","production"}
        if contribution_type not in allowed_types:
            raise gl.vm.UserError(f"contribution_type must be one of: {sorted(allowed_types)}")
        raw = self.tracks.get(track_id, None)
        if raw is None: raise gl.vm.UserError(f"unknown track_id: {track_id}")
        if json.loads(raw)["status"] != "active": raise gl.vm.UserError(f"track {track_id} is not active")
        proposal_id = str(self.next_proposal_id)
        self.next_proposal_id = self.next_proposal_id + u256(1)
        proposer = str(gl.message.sender_address)
        self.proposals[proposal_id] = json.dumps({
            "id": proposal_id, "track_id": track_id, "proposer": proposer,
            "contribution_text": contribution_text, "contribution_type": contribution_type,
            "status": "pending", "scores": None, "evolved_content": None, "rationale": None,
        })
        self._emit("PROPOSAL_SUBMITTED", {"proposal_id": proposal_id, "track_id": track_id, "proposer": proposer})
        return proposal_id

    @gl.public.write
    def set_audio_url(self, track_id: str, audio_url: str) -> str:
        self._validate_text(audio_url, 500, "audio_url")
        raw = self.tracks.get(track_id, None)
        if raw is None: raise gl.vm.UserError(f"unknown track_id: {track_id}")
        track = json.loads(raw)
        caller = str(gl.message.sender_address)
        if caller != track["creator"] and caller not in track.get("contributors", []):
            raise gl.vm.UserError("only creator or contributor can set audio URL")
        track["audio_url"] = audio_url[:500]
        self.tracks[track_id] = json.dumps(track)
        self._emit("AUDIO_SET", {"track_id": track_id})
        return f"audio URL set for track {track_id}"

    @gl.public.write
    def evaluate_proposal(self, proposal_id: str) -> str:
        raw_proposal = self.proposals.get(proposal_id, None)
        if raw_proposal is None: raise gl.vm.UserError(f"unknown proposal_id: {proposal_id}")
        proposal = json.loads(raw_proposal)
        if proposal["status"] != "pending": raise gl.vm.UserError(f"proposal {proposal_id} already evaluated")
        raw_track = self.tracks.get(proposal["track_id"], None)
        if raw_track is None: raise gl.vm.UserError("track no longer exists")
        track = json.loads(raw_track)

        verdict = self._judge_evolution(track, proposal)
        composite = (verdict["originality"] + verdict["quality"] + verdict["emotional"] + verdict["canon_fit"]) // 4
        plagiarism_blocked = verdict.get("plagiarism_risk") == "high"

        if (not verdict["approve"]) or composite < int(self.approval_threshold) or plagiarism_blocked:
            proposal["status"] = "rejected"
            proposal["scores"] = verdict
            proposal["rationale"] = verdict["rationale"]
            self.proposals[proposal_id] = json.dumps(proposal)
            self._emit("PROPOSAL_REJECTED", {"proposal_id": proposal_id, "track_id": proposal["track_id"], "composite_score": composite})
            return json.dumps({"proposal_id": proposal_id, "status": "rejected", "composite_score": composite, "plagiarism_risk": verdict.get("plagiarism_risk","unknown"), "rationale": verdict["rationale"]})

        history_entry = {
            "version": track["version"] + 1, "contributor": proposal["proposer"],
            "proposal_id": proposal_id, "rationale": verdict["rationale"],
            "scores": {"originality": verdict["originality"], "quality": verdict["quality"], "emotional": verdict["emotional"], "canon_fit": verdict["canon_fit"]},
        }
        track["history"] = track.get("history", []) + [history_entry]
        track["current_content"] = verdict["evolved_content"]
        track["version"] = track["version"] + 1
        track["audio_url"] = ""
        contributors = track.get("contributors", [track["creator"]])
        if proposal["proposer"] not in contributors:
            contributors.append(proposal["proposer"])
        track["contributors"] = contributors
        self.tracks[track["id"]] = json.dumps(track)

        proposal["status"] = "approved"
        proposal["scores"] = verdict
        proposal["evolved_content"] = verdict["evolved_content"]
        proposal["rationale"] = verdict["rationale"]
        self.proposals[proposal_id] = json.dumps(proposal)

        contributor_addr = Address(proposal["proposer"])
        self.contribution_count[contributor_addr] = (self.contribution_count.get(contributor_addr, u256(0)) + u256(1))
        reward = self._calculate_reward(composite)
        if reward > u256(0):
            self.pending_rewards[contributor_addr] = (self.pending_rewards.get(contributor_addr, u256(0)) + reward)
            self.treasury_locked = self.treasury_locked + reward

        self._emit("PROPOSAL_APPROVED", {"proposal_id": proposal_id, "track_id": proposal["track_id"], "new_version": str(track["version"]), "composite_score": str(composite), "contributor": proposal["proposer"], "reward": str(reward)})
        return json.dumps({"proposal_id": proposal_id, "status": "approved", "composite_score": composite, "new_version": track["version"], "reward_credited": str(reward), "credited_to": str(contributor_addr)})

    @gl.public.write.payable
    def fund_treasury(self) -> str:
        if gl.message.value == u256(0): raise gl.vm.UserError("send GEN to fund treasury")
        self._emit("TREASURY_FUNDED", {"amount": str(gl.message.value)})
        return f"treasury funded with {gl.message.value} wei"

    @gl.public.write
    def claim_rewards(self) -> str:
        claimant = gl.message.sender_address
        amount = self.pending_rewards.get(claimant, u256(0))
        if amount == u256(0): raise gl.vm.UserError("no pending rewards to claim")
        if self.balance < amount: raise gl.vm.UserError("treasury balance temporarily insufficient")
        gl.transfer(claimant, amount)
        self.pending_rewards[claimant] = u256(0)
        self.treasury_locked = (self.treasury_locked - amount if self.treasury_locked >= amount else u256(0))
        self._emit("REWARD_CLAIMED", {"claimant": str(claimant), "amount": str(amount)})
        return f"transferred {amount} wei to {claimant}"

    @gl.public.write.payable
    def mint_element(self, track_id: str, kind: str) -> str:
        self._require_not_paused()
        self._validate_text(kind, 100, "kind")
        raw = self.tracks.get(track_id, None)
        if raw is None: raise gl.vm.UserError(f"unknown track_id: {track_id}")
        track = json.loads(raw)
        if gl.message.value == u256(0): raise gl.vm.UserError("send GEN to mint an element")
        element_id = str(self.next_element_id)
        self.next_element_id = self.next_element_id + u256(1)
        minter = str(gl.message.sender_address)
        self.minted_elements[element_id] = json.dumps({"id": element_id, "track_id": track_id, "kind": kind, "owner": minter, "version_at_mint": track["version"]})

        mint_value = gl.message.value
        creator_share = (mint_value * self.creator_royalty_bps) // BPS_DENOMINATOR
        contrib_pool = mint_value - creator_share
        creator = Address(track["creator"])
        self.pending_rewards[creator] = (self.pending_rewards.get(creator, u256(0)) + creator_share)
        self.treasury_locked = self.treasury_locked + creator_share
        other_contribs = [c for c in track.get("contributors", []) if c != track["creator"]]
        if other_contribs and contrib_pool > u256(0):
            per_contrib = contrib_pool // u256(len(other_contribs))
            if per_contrib > u256(0):
                for addr_str in other_contribs:
                    try:
                        addr = Address(addr_str)
                        self.pending_rewards[addr] = (self.pending_rewards.get(addr, u256(0)) + per_contrib)
                        self.treasury_locked = self.treasury_locked + per_contrib
                    except Exception:
                        pass

        self._emit("ELEMENT_MINTED", {"element_id": element_id, "track_id": track_id, "minter": minter, "value": str(mint_value)})
        return element_id

    @gl.public.view
    def get_track(self, track_id: str) -> str:
        raw = self.tracks.get(track_id, None)
        if raw is None: raise gl.vm.UserError(f"track {track_id} not found")
        return raw

    @gl.public.view
    def get_track_history(self, track_id: str) -> str:
        raw = self.tracks.get(track_id, None)
        if raw is None: raise gl.vm.UserError(f"track {track_id} not found")
        return json.dumps(json.loads(raw).get("history", []))

    @gl.public.view
    def list_active_tracks(self) -> DynArray[str]:
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
    def get_my_tracks(self) -> str:
        caller = str(gl.message.sender_address)
        result = []
        i = u256(0)
        while i < self.next_track_id:
            track_id = str(i)
            raw = self.tracks.get(track_id, None)
            if raw is not None:
                track = json.loads(raw)
                if track.get("creator") == caller or caller in track.get("contributors", []):
                    result.append(track_id)
            i = i + u256(1)
        return json.dumps(result)

    @gl.public.view
    def get_tracks_by_genre(self, genre: str) -> str:
        g = genre.lower().strip()
        result = []
        i = u256(0)
        while i < self.next_track_id:
            track_id = str(i)
            raw = self.tracks.get(track_id, None)
            if raw is not None:
                track = json.loads(raw)
                if track.get("genre","").lower().strip() == g and track.get("status") == "active":
                    result.append(track_id)
            i = i + u256(1)
        return json.dumps(result)

    @gl.public.view
    def get_top_tracks(self, limit: str) -> str:
        try:
            limit_n = min(int(limit), MAX_TOP_TRACKS)
        except Exception:
            limit_n = 10
        scored = []
        i = u256(0)
        while i < self.next_track_id:
            track_id = str(i)
            raw = self.tracks.get(track_id, None)
            if raw is not None:
                track = json.loads(raw)
                if track.get("status") == "active":
                    scored.append((track.get("version", 0), track_id))
            i = i + u256(1)
        scored.sort(key=lambda x: x[0], reverse=True)
        return json.dumps([tid for _, tid in scored[:limit_n]])

    @gl.public.view
    def get_proposal(self, proposal_id: str) -> str:
        raw = self.proposals.get(proposal_id, None)
        if raw is None: raise gl.vm.UserError(f"proposal {proposal_id} not found")
        return raw

    @gl.public.view
    def get_pending_rewards(self, address: str) -> u256:
        return self.pending_rewards.get(Address(address), u256(0))

    @gl.public.view
    def get_treasury_balance(self) -> u256:
        return self.balance

    @gl.public.view
    def get_contribution_count(self, address: str) -> u256:
        return self.contribution_count.get(Address(address), u256(0))

    @gl.public.view
    def get_minted_element(self, element_id: str) -> str:
        raw = self.minted_elements.get(element_id, None)
        if raw is None: raise gl.vm.UserError(f"element {element_id} not found")
        return raw

    @gl.public.view
    def get_my_minted_elements(self) -> DynArray[str]:
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
    def get_events(self, from_id: str, limit: str) -> str:
        try:
            start = int(from_id)
            n = min(int(limit), 100)
        except Exception:
            return "[]"
        result = []
        i = start
        while i < start + n and i < int(self.next_event_id):
            raw = self.events.get(str(i), None)
            if raw is not None:
                result.append(json.loads(raw))
            i += 1
        return json.dumps(result)

    @gl.public.view
    def get_config(self) -> str:
        return json.dumps({
            "approval_threshold":  int(self.approval_threshold),
            "max_reward_bps":      int(self.max_reward_bps),
            "min_reward_score":    int(self.min_reward_score),
            "max_prompt_chars":    int(self.max_prompt_chars),
            "creator_royalty_bps": int(self.creator_royalty_bps),
            "is_paused":           int(self.is_paused) == 1,
        })

    @gl.public.view
    def get_owner(self) -> Address:
        return self.owner

    def _require_owner(self) -> None:
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("owner only")

    def _require_not_paused(self) -> None:
        if self.is_paused != u256(0):
            raise gl.vm.UserError("contract is paused")

    def _validate_text(self, text: str, max_len: int, field: str) -> None:
        if not text or not text.strip():
            raise gl.vm.UserError(f"{field} cannot be empty")
        if len(text) > max_len:
            raise gl.vm.UserError(f"{field} too long: max {max_len} chars, got {len(text)}")
        for bad in ["\x00", "<script", "javascript:"]:
            if bad in text.lower():
                raise gl.vm.UserError(f"{field} contains forbidden content")

    def _emit(self, event_type: str, data: dict) -> None:
        event_id = str(self.next_event_id)
        self.next_event_id = self.next_event_id + u256(1)
        self.events[event_id] = json.dumps({"id": event_id, "type": event_type, "data": data})

    def _available_treasury(self) -> u256:
        bal = self.balance
        return u256(0) if bal <= self.treasury_locked else bal - self.treasury_locked

    def _calculate_reward(self, composite_score: int) -> u256:
        if u256(composite_score) < self.min_reward_score:
            return u256(0)
        available = self._available_treasury()
        if available == u256(0):
            return u256(0)
        capped = max(0, min(100, composite_score))
        score_sq = u256(capped * capped)
        max_slice = (available * self.max_reward_bps) // BPS_DENOMINATOR
        reward = (max_slice * score_sq) // u256(10000)
        if reward > max_slice: reward = max_slice
        if reward > u256(0) and reward < MIN_REWARD_WEI:
            reward = MIN_REWARD_WEI if available >= MIN_REWARD_WEI else available
        return reward

    def _fetch_web_context(self, url: str = "") -> str:
        if not url: return ""
        try:
            return gl.nondet.web.render(url, mode="text")[:1500]
        except Exception:
            return ""

    def _build_prompt(self, track: dict, proposal: dict, context: str) -> str:
        return f"""You are a senior music A&R executive and creative director for HarmonyForge — a decentralised collaborative music project. Judge whether the proposed contribution should be permanently merged into the canon.

TRACK TITLE: {track["title"]}
GENRE: {track["genre"]}
CURRENT CANON CONTENT:
{track["current_content"][:1000]}

PROPOSED CONTRIBUTION TYPE: {proposal["contribution_type"]}
PROPOSED CONTRIBUTION:
{proposal["contribution_text"][:800]}

REFERENCE CONTEXT (may be empty): {context}

SCORING CRITERIA — score each 0-100:
1. ORIGINALITY: Genuinely new ideas, distinct from existing content, avoids clichés
2. QUALITY: Technical strength, vivid and specific language, intentional craft
3. EMOTIONAL IMPACT: Clear emotional response, deepens the mood
4. CANON FIT: Complements and enhances existing content, stylistically consistent

PLAGIARISM RISK: "low" (clearly original) | "medium" (similar but distinct) | "high" (too close to copyrighted material)

APPROVE if average score >= 60 AND plagiarism_risk != "high".
If approved, write the COMPLETE merged track content integrating the contribution.

Return ONLY valid JSON (no markdown, no extra text):
{{"approve": boolean, "originality": 0-100, "quality": 0-100, "emotional": 0-100, "canon_fit": 0-100, "plagiarism_risk": "low"|"medium"|"high", "evolved_content": "complete merged content or empty string", "rationale": "1-2 sentence explanation max 300 chars"}}"""

    def _judge_evolution(self, track: dict, proposal: dict) -> dict:
        genre = track.get("genre", "")
        url = ("https://en.wikipedia.org/wiki/" + genre.strip().replace(" ", "_")) if genre else ""
        context = self._fetch_web_context(url)
        prompt = self._build_prompt(track, proposal, context)

        def leader_fn():
            try:
                result = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception as e:
                raise gl.vm.UserError(f"LLM call failed: {str(e)[:100]}")
            if not isinstance(result, dict):
                raise gl.vm.UserError("LLM returned non-dict response")
            result.setdefault("approve", False)
            result.setdefault("originality", 0)
            result.setdefault("quality", 0)
            result.setdefault("emotional", 0)
            result.setdefault("canon_fit", 0)
            result.setdefault("plagiarism_risk", "low")
            result.setdefault("evolved_content", "")
            result.setdefault("rationale", "no rationale provided")
            return result

        def validator_fn(leader_result) -> bool:
            """
            Validators independently re-run the LLM and check only the binary
            approve/reject decision and plagiarism risk. Per-axis scores are
            subjective and vary naturally between LLM runs — requiring score
            agreement within a tight tolerance causes false rejections on valid
            creative content. The Optimistic Democracy contract is: do you agree
            with the overall decision? Not: did you score it identically?
            """
            if not isinstance(leader_result, gl.vm.Return): return False
            d = leader_result.calldata
            if not isinstance(d, dict): return False

            # Structural check — must have correct shape
            if not isinstance(d.get("approve"), bool): return False
            if d.get("plagiarism_risk") not in ("low", "medium", "high"): return False
            score_keys = ("originality", "quality", "emotional", "canon_fit")
            for k in score_keys:
                if not isinstance(d.get(k), int) or not (0 <= d[k] <= 100):
                    return False

            # Independent re-judgment — check decision only, not scores
            try:
                v = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception:
                return False
            if not isinstance(v, dict): return False

            # Only require agreement on the binary approve/reject and plagiarism
            if bool(v.get("approve")) != bool(d.get("approve")): return False
            if v.get("plagiarism_risk") != d.get("plagiarism_risk"): return False

            return True

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
