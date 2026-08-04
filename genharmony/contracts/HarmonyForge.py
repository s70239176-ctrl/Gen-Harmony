# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

APPROVAL_THRESHOLD = 60
MAX_REWARD_BPS    = u256(1000)
BPS_DENOMINATOR   = u256(10000)
MIN_REWARD_WEI    = u256(10_000_000_000_000_000)
SCORE_TOLERANCE   = 20


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

    @gl.public.write
    def submit_seed(self, title: str, seed_prompt: str, genre: str) -> str:
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
    def propose_evolution(self, track_id: str, contribution_text: str, contribution_type: str) -> str:
        raw = self.tracks.get(track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"unknown track_id: {track_id}")
        if json.loads(raw)["status"] != "active":
            raise gl.vm.UserError(f"track {track_id} is not active")
        if not contribution_text.strip():
            raise gl.vm.UserError("contribution_text cannot be empty")
        proposal_id = str(self.next_proposal_id)
        self.next_proposal_id = self.next_proposal_id + u256(1)
        self.proposals[proposal_id] = json.dumps({
            "id": proposal_id, "track_id": track_id,
            "proposer": str(gl.message.sender_address),
            "contribution_text": contribution_text,
            "contribution_type": contribution_type,
            "status": "pending", "scores": None,
            "evolved_content": None, "rationale": None,
        })
        return proposal_id

    @gl.public.write
    def evaluate_proposal(self, proposal_id: str) -> str:
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

        verdict = self._judge_evolution(track, proposal)
        composite = (verdict["originality"] + verdict["quality"] +
                     verdict["emotional"] + verdict["canon_fit"]) // 4

        if (not verdict["approve"]) or composite < APPROVAL_THRESHOLD:
            proposal["status"]    = "rejected"
            proposal["scores"]    = verdict
            proposal["rationale"] = verdict["rationale"]
            self.proposals[proposal_id] = json.dumps(proposal)
            return json.dumps({"proposal_id": proposal_id, "status": "rejected", "composite_score": composite})

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
            "proposal_id": proposal_id, "status": "approved",
            "composite_score": composite, "new_version": track["version"],
            "reward_credited": str(reward), "credited_to": str(contributor_addr),
        })

    @gl.public.write.payable
    def fund_treasury(self) -> str:
        if gl.message.value == u256(0):
            raise gl.vm.UserError("send GEN with this call to fund the treasury")
        return f"treasury funded with {gl.message.value} wei"

    @gl.public.write
    def claim_rewards(self) -> str:
        claimant = gl.message.sender_address
        amount   = self.pending_rewards.get(claimant, u256(0))
        if amount == u256(0):
            raise gl.vm.UserError("no pending rewards to claim")
        if self.balance < amount:
            raise gl.vm.UserError("treasury balance temporarily insufficient")
        gl.transfer(claimant, amount)
        self.pending_rewards[claimant] = u256(0)
        self.treasury_locked = (
            self.treasury_locked - amount if self.treasury_locked >= amount else u256(0)
        )
        return f"transferred {amount} wei to {claimant}"

    @gl.public.write.payable
    def mint_element(self, track_id: str, kind: str) -> str:
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

    @gl.public.view
    def get_track(self, track_id: str) -> str:
        raw = self.tracks.get(track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"track {track_id} not found")
        return raw

    @gl.public.view
    def get_proposal(self, proposal_id: str) -> str:
        raw = self.proposals.get(proposal_id, None)
        if raw is None:
            raise gl.vm.UserError(f"proposal {proposal_id} not found")
        return raw

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
        if raw is None:
            raise gl.vm.UserError(f"element {element_id} not found")
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

    def _fetch_web_context(self, url: str = "") -> str:
        if not url:
            return ""
        try:
            return gl.nondet.web.render(url, mode="text")[:2000]
        except Exception:
            return ""

    def _build_prompt(self, track: dict, proposal: dict, context: str) -> str:
        return f"""You are the artistic jury for HarmonyForge. Judge whether the PROPOSED CONTRIBUTION should be merged into the TRACK's canon.

TRACK TITLE: {track['title']}
GENRE: {track['genre']}
CURRENT CANON CONTENT: {track['current_content']}
CONTRIBUTION TYPE: {proposal['contribution_type']}
PROPOSED CONTRIBUTION: {proposal['contribution_text']}
WEB CONTEXT: {context}

Return ONLY a JSON object with keys:
- "approve": boolean
- "quality": integer 0-100
- "originality": integer 0-100
- "emotional": integer 0-100
- "canon_fit": integer 0-100
- "evolved_content": string (merged content if approved, else "")
- "rationale": string (<= 280 chars)"""

    def _judge_evolution(self, track: dict, proposal: dict) -> dict:
        genre   = track.get("genre", "")
        url     = ("https://en.wikipedia.org/wiki/" + genre.strip().replace(" ", "_")) if genre else ""
        context = self._fetch_web_context(url)
        prompt  = self._build_prompt(track, proposal, context)

        def leader_fn():
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(result, dict):
                raise gl.vm.UserError("leader returned non-dict")
            return result

        def validator_fn(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            d = leader_result.calldata
            if not isinstance(d, dict):
                return False
            score_keys = ("quality", "originality", "emotional", "canon_fit")
            if not isinstance(d.get("approve"), bool):
                return False
            for k in score_keys:
                if not isinstance(d.get(k), int) or not (0 <= d[k] <= 100):
                    return False
            try:
                v = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception:
                return False
            if not isinstance(v, dict):
                return False
            if v.get("approve") != d.get("approve"):
                return False
            for k in score_keys:
                if not isinstance(v.get(k), int):
                    return False
                if abs(v[k] - d[k]) > SCORE_TOLERANCE:
                    return False
            return True

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
