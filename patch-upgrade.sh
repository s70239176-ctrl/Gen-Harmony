#!/usr/bin/env bash
set -e
echo "→ Applying GenHarmony v2 upgrade..."
mkdir -p contracts components lib

cat > contracts/HarmonyForge.py << 'HEREDOC_ebf0da794037'
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

# ---------------------------------------------------------------------------
# Default constants (all owner-updatable via update_config)
# ---------------------------------------------------------------------------
DEFAULT_APPROVAL_THRESHOLD  = u256(60)
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
            if not isinstance(leader_result, gl.vm.Return): return False
            d = leader_result.calldata
            if not isinstance(d, dict): return False
            score_keys = ("originality", "quality", "emotional", "canon_fit")
            if not isinstance(d.get("approve"), bool): return False
            if d.get("plagiarism_risk") not in ("low","medium","high"): return False
            for k in score_keys:
                if not isinstance(d.get(k), int) or not (0 <= d[k] <= 100): return False
            try:
                v = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception:
                return False
            if not isinstance(v, dict): return False
            if bool(v.get("approve")) != bool(d.get("approve")): return False
            if v.get("plagiarism_risk") != d.get("plagiarism_risk"): return False
            for k in score_keys:
                vv, lv = v.get(k), d.get(k)
                if not isinstance(vv, int) or not isinstance(lv, int): return False
                if abs(vv - lv) > SCORE_TOLERANCE: return False
            return True

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

HEREDOC_ebf0da794037

cat > lib/genlayer.ts << 'HEREDOC_a7f10c22e34b'
"use client";

import { defineChain } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createConfig, http, useAccount, useWalletClient, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { useCallback, useMemo } from "react";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Track, Proposal, MintedElement } from "./types";

export const genLayerStudio = defineChain({
  id: 61_999,
  name: "GenLayer Studio",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: ["https://studio.genlayer.com:8443/api"] } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [genLayerStudio],
  connectors: [injected()],
  transports: { [genLayerStudio.id]: http() },
});

export const CONTRACT_ADDRESS =
  "0x3F51358206490CcB8eDD2D40Fd8bb42bCd39F363" as const;

const GL_KEY = "genharmony_contributor_pk";

function getOrCreateContributorKey(): `0x${string}` {
  if (typeof window === "undefined")
    return "0x0000000000000000000000000000000000000000000000000000000000000001";
  let pk = localStorage.getItem(GL_KEY) as `0x${string}` | null;
  if (!pk) { pk = generatePrivateKey(); localStorage.setItem(GL_KEY, pk); }
  return pk;
}

export function getContributorAddress(): string {
  if (typeof window === "undefined") return "";
  try { return privateKeyToAccount(getOrCreateContributorKey()).address; } catch { return ""; }
}

function coerce<T>(v: unknown): T {
  if (typeof v === "string") { try { return JSON.parse(v) as T; } catch { return v as unknown as T; } }
  return v as unknown as T;
}

export function useHarmonyForge() {
  const { isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient({ config: wagmiConfig });
  const { switchChainAsync } = useSwitchChain({ config: wagmiConfig });

  const read = useCallback(async <T,>(functionName: string, args: unknown[] = []): Promise<T> => {
    const client = createClient({ chain: studionet });
    const result = await client.readContract({ address: CONTRACT_ADDRESS, functionName, args: args as never[] });
    return coerce<T>(result);
  }, []);

  const write = useCallback(async (
    functionName: string, args: unknown[] = [], value = BigInt(0),
  ): Promise<{ txHash: string; result: unknown }> => {
    // Auto-switch chain if needed
    if (chainId !== genLayerStudio.id) {
      try { await switchChainAsync({ chainId: genLayerStudio.id }); }
      catch { throw new Error(`Please switch to GenLayer Studio network (chain ${genLayerStudio.id}) in your wallet.`); }
      throw new Error("Switched to GenLayer Studio — please click again to continue.");
    }
    const pk = getOrCreateContributorKey();
    const account = createAccount(pk);
    const client = createClient({ chain: studionet, account });
    const txHash = await client.writeContract({
      account, address: CONTRACT_ADDRESS, functionName, args: args as never[], value,
    });
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, status: TransactionStatus.ACCEPTED });
    const result = (receipt as unknown as Record<string, unknown>).result ?? txHash;
    return { txHash: txHash as string, result };
  }, [chainId, switchChainAsync]);

  return useMemo(() => ({
    submitSeed: (title: string, seedPrompt: string, genre: string) =>
      write("submit_seed", [title, seedPrompt, genre]).then(({ result }) => coerce<string>(result)),
    proposeEvolution: (trackId: string, text: string, type: string) =>
      write("propose_evolution", [trackId, text, type]).then(({ result }) => coerce<string>(result)),
    forkTrack: (parentTrackId: string, newTitle: string) =>
      write("fork_track", [parentTrackId, newTitle]).then(({ result }) => coerce<string>(result)),
    evaluateProposal: (proposalId: string) =>
      write("evaluate_proposal", [proposalId]).then(({ txHash }) => txHash),
    fundTreasury: (valueWei: bigint) =>
      write("fund_treasury", [], valueWei).then(({ txHash }) => txHash),
    claimRewards: () => write("claim_rewards", []).then(({ txHash }) => txHash),
    mintElement: (trackId: string, kind: string, valueWei: bigint) =>
      write("mint_element", [trackId, kind], valueWei).then(({ result }) => coerce<string>(result)),
    setAudioUrl: (trackId: string, audioUrl: string) =>
      write("set_audio_url", [trackId, audioUrl]).then(({ txHash }) => txHash),
    updateConfig: (key: string, value: bigint) =>
      write("update_config", [key, value]).then(({ txHash }) => txHash),
    pause: () => write("pause", []).then(({ txHash }) => txHash),
    unpause: () => write("unpause", []).then(({ txHash }) => txHash),

    getTrack: (trackId: string) => read<Track>("get_track", [trackId]),
    getTrackHistory: (trackId: string) =>
      read<unknown>("get_track_history", [trackId]).then((v) => coerce<HistoryEntry[]>(v)),
    getProposal: (proposalId: string) => read<Proposal>("get_proposal", [proposalId]),
    listActiveTracks: () => read<string[]>("list_active_tracks", []),
    getMyTracks: () => read<unknown>("get_my_tracks", []).then((v) => coerce<string[]>(v)),
    getTracksByGenre: (genre: string) =>
      read<unknown>("get_tracks_by_genre", [genre]).then((v) => coerce<string[]>(v)),
    getTopTracks: (limit = 10) =>
      read<unknown>("get_top_tracks", [String(limit)]).then((v) => coerce<string[]>(v)),
    getPendingRewards: (addr: string) => read<unknown>("get_pending_rewards", [addr]).then(String),
    getTreasuryBalance: () => read<unknown>("get_treasury_balance", []).then(String),
    getContributionCount: (addr: string) => read<unknown>("get_contribution_count", [addr]).then(String),
    getMyMintedElements: () => read<string[]>("get_my_minted_elements", []),
    getMintedElement: (elementId: string) => read<MintedElement>("get_minted_element", [elementId]),
    getConfig: () => read<unknown>("get_config", []).then((v) => coerce<ContractConfig>(v)),
    getEvents: (fromId: number, limit: number) =>
      read<unknown>("get_events", [String(fromId), String(limit)]).then((v) => coerce<ContractEvent[]>(v)),
  }), [read, write]);
}

export interface HistoryEntry {
  version: number;
  contributor: string;
  proposal_id: string | null;
  rationale: string;
  scores: { originality: number; quality: number; emotional: number; canon_fit: number } | null;
}

export interface ContractConfig {
  approval_threshold: number;
  max_reward_bps: number;
  min_reward_score: number;
  max_prompt_chars: number;
  creator_royalty_bps: number;
  is_paused: boolean;
}

export interface ContractEvent {
  id: string;
  type: string;
  data: Record<string, string>;
}

HEREDOC_a7f10c22e34b

cat > lib/types.ts << 'HEREDOC_e3411495b8c9'
export interface Track {
  id: string;
  title: string;
  genre: string;
  creator: string;
  status: "active" | "archived";
  current_content: string;
  version: number;
  parent_track_id?: string | null;
  contributors?: string[];
  audio_url?: string;
  history?: HistoryEntry[];
}

export interface HistoryEntry {
  version: number;
  contributor: string;
  proposal_id: string | null;
  rationale: string;
  scores: {
    originality: number;
    quality: number;
    emotional: number;
    canon_fit: number;
  } | null;
}

export interface ProposalScores {
  approve: boolean;
  quality: number;
  originality: number;
  emotional: number;
  canon_fit: number;
  plagiarism_risk?: "low" | "medium" | "high";
  evolved_content: string;
  rationale: string;
}

export interface Proposal {
  id: string;
  track_id: string;
  proposer: string;
  contribution_text: string;
  contribution_type: string;
  status: "pending" | "approved" | "rejected";
  scores: ProposalScores | null;
  evolved_content: string | null;
  rationale: string | null;
}

export interface MintedElement {
  id: string;
  track_id: string;
  kind: string;
  owner: string;
  version_at_mint: number;
}

HEREDOC_e3411495b8c9

cat > components/App.tsx << 'HEREDOC_65c0817aebde'
"use client";

import { useState, useEffect } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/genlayer";
import { Navigation, type View } from "./Navigation";
import { TrackGrid } from "./TrackGrid";
import { TrackDetail } from "./TrackDetail";
import { RewardsPanel } from "./RewardsPanel";
import { NetworkGuard } from "./NetworkGuard";

const queryClient = new QueryClient();

function Shell() {
  const [view, setView] = useState<View>("deck");
  const [openTrackId, setOpenTrackId] = useState<string | null>(null);

  // Support shareable ?track=N links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("track");
    if (t) { setOpenTrackId(t); setView("deck"); }
  }, []);

  return (
    <div className="min-h-screen">
      <Navigation
        view={view}
        onChange={(v) => { setView(v); setOpenTrackId(null); }}
      />
      <main className="ml-[4.5rem] px-6 pb-16 pt-24 lg:px-10">
        <div className="mx-auto max-w-6xl">
          {view === "deck" && (
            openTrackId
              ? <TrackDetail trackId={openTrackId} onBack={() => setOpenTrackId(null)} />
              : <TrackGrid onOpen={setOpenTrackId} />
          )}
          {view === "rewards" && <RewardsPanel />}
        </div>
      </main>
      <NetworkGuard />
    </div>
  );
}

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <Shell />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

HEREDOC_65c0817aebde

cat > components/NetworkGuard.tsx << 'HEREDOC_0ce7a09efe4e'
"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { wagmiConfig, genLayerStudio } from "@/lib/genlayer";
import { AlertTriangle, Zap } from "lucide-react";
import { Button } from "./ui/Button";
import { useState } from "react";

export function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain({ config: wagmiConfig });
  const [switching, setSwitching] = useState(false);

  if (!isConnected || chainId === genLayerStudio.id) return null;

  async function handleSwitch() {
    setSwitching(true);
    try { await switchChainAsync({ chainId: genLayerStudio.id }); }
    catch { /* user rejected */ }
    finally { setSwitching(false); }
  }

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-rise-in">
      <div className="flex items-center gap-3 rounded-md border border-vinyl/40 bg-panel px-5 py-3
        shadow-glow-vinyl">
        <AlertTriangle className="h-4 w-4 text-vinyl" />
        <p className="font-mono text-[12px] text-ink">
          Wrong network — switch to{" "}
          <span className="text-vinyl">GenLayer Studio</span> to write
        </p>
        <Button variant="vinyl" loading={switching} onClick={handleSwitch} className="!px-3 !py-1.5">
          <Zap className="h-3 w-3" />
          Switch
        </Button>
      </div>
    </div>
  );
}

HEREDOC_0ce7a09efe4e

cat > components/EvaluateProposalButton.tsx << 'HEREDOC_cc7cb5890e2f'
"use client";

import { useState, useEffect } from "react";
import { Gavel, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Button } from "./ui/Button";
import { VuMeter } from "./VuMeter";
import { useHarmonyForge } from "@/lib/genlayer";

type State = "idle" | "judging" | "submitted" | "error";

export function EvaluateProposalButton({
  proposalId, onResolved,
}: { proposalId: string; onResolved?: () => void; }) {
  const { evaluateProposal } = useHarmonyForge();
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Tick a visible timer while the LLM jury deliberates (takes 30-90s)
  useEffect(() => {
    if (state !== "judging") { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  async function handleEvaluate() {
    setState("judging");
    setError(null);
    try {
      await evaluateProposal(proposalId);
      setState("submitted");
      onResolved?.();
    } catch (err) {
      const raw = err instanceof Error ? err.message
        : typeof err === "object" && err !== null ? JSON.stringify(err) : String(err);
      if (raw.includes("non-whitespace") || raw.includes("JSON at position")) {
        setState("submitted"); onResolved?.();
      } else {
        setError(raw); setState("error");
      }
    }
  }

  if (state === "judging") {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-4 py-2.5">
          <VuMeter label="Jury deliberating" />
          <span className="ml-auto flex items-center gap-1 font-mono text-[11px] text-muted">
            <Clock className="h-3 w-3" />
            {elapsed}s
          </span>
        </div>
        <p className="font-mono text-[10px] text-muted">
          LLM consensus takes 30–90 seconds — do not close this tab
        </p>
      </div>
    );
  }

  if (state === "submitted") {
    return (
      <div className="flex items-center gap-2 rounded-sm border border-current/40 px-4 py-2.5 text-current">
        <CheckCircle2 className="h-4 w-4" />
        <span className="font-mono text-[12px] uppercase tracking-[0.1em]">
          Submitted — refresh track to see verdict
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Button variant="secondary" onClick={handleEvaluate} className="gap-2">
        <Gavel className="h-3.5 w-3.5" />
        Convene the jury
      </Button>
      {state === "error" && error && (
        <p className="font-mono text-[12px] text-pulse">{error}</p>
      )}
    </div>
  );
}

HEREDOC_cc7cb5890e2f

cat > components/TrackHistory.tsx << 'HEREDOC_d01fb4d8cc38'
"use client";

import { useEffect, useState } from "react";
import { useHarmonyForge } from "@/lib/genlayer";
import type { HistoryEntry } from "@/lib/types";

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">{label}</span>
      <div className="h-1 flex-1 rounded-full bg-line">
        <div
          className="h-1 rounded-full bg-gradient-to-r from-pulse to-current transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="led w-7 text-right text-[10px] text-ink">{value}</span>
    </div>
  );
}

export function TrackHistory({ trackId }: { trackId: string }) {
  const { getTrackHistory } = useHarmonyForge();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getTrackHistory(trackId)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackId]);

  if (loading) return (
    <p className="font-mono text-[12px] text-muted">Loading lineage…</p>
  );

  return (
    <ol className="relative space-y-0 border-l border-line pl-6">
      {[...history].reverse().map((entry) => (
        <li key={entry.version} className="relative py-4">
          <span
            className={`absolute -left-[27px] top-5 h-3 w-3 rounded-full border-2 ${
              entry.version === history[history.length - 1]?.version
                ? "border-pulse bg-pulse shadow-glow-pulse"
                : "border-line bg-rail"
            }`}
          />
          <div className="flex items-baseline gap-3 mb-1">
            <span className="led text-[12px] text-ink">v{entry.version}</span>
            {entry.version === 0
              ? <span className="font-mono text-[10px] text-muted">Genesis seed</span>
              : <span className="font-mono text-[10px] text-muted">by {entry.contributor.slice(0, 8)}…</span>
            }
            {entry.proposal_id && (
              <span className="led text-[10px] text-muted/60">#{entry.proposal_id}</span>
            )}
          </div>
          {entry.rationale && (
            <p className="font-body text-[13px] text-muted leading-relaxed mb-2">{entry.rationale}</p>
          )}
          {entry.scores && (
            <div className="mt-2 space-y-1 rounded-sm border border-line/40 bg-rail/40 p-3">
              <ScoreBar label="Originality" value={entry.scores.originality} />
              <ScoreBar label="Quality"     value={entry.scores.quality} />
              <ScoreBar label="Emotional"   value={entry.scores.emotional} />
              <ScoreBar label="Canon fit"   value={entry.scores.canon_fit} />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

HEREDOC_d01fb4d8cc38

cat > components/AudioPlayer.tsx << 'HEREDOC_5bae396e9574'
"use client";

import { useState, useRef } from "react";
import { Play, Pause, Music2, ExternalLink } from "lucide-react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Field";
import { useHarmonyForge } from "@/lib/genlayer";

interface Props {
  trackId: string;
  audioUrl?: string;
  onAudioSet?: () => void;
}

export function AudioPlayer({ trackId, audioUrl, onAudioSet }: Props) {
  const { setAudioUrl } = useHarmonyForge();
  const [playing, setPlaying] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else { audioRef.current.play(); setPlaying(true); }
  }

  async function handleSave() {
    if (!urlInput.trim()) return;
    setSaving(true); setError(null);
    try {
      await setAudioUrl(trackId, urlInput.trim());
      setShowInput(false);
      onAudioSet?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally { setSaving(false); }
  }

  if (audioUrl) return (
    <div className="flex items-center gap-3 rounded-sm border border-line bg-rail/60 px-4 py-2.5">
      <audio
        ref={audioRef}
        src={audioUrl}
        onEnded={() => setPlaying(false)}
        className="hidden"
      />
      <button
        onClick={togglePlay}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-pulse/50
          text-pulse transition-colors hover:bg-pulse/10"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <div className="flex-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
          {playing ? "Now playing" : "Audio available"}
        </p>
      </div>
      <a
        href={audioUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted hover:text-ink"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-sm border border-line/60 bg-rail/40 px-4 py-2.5">
        <Music2 className="h-4 w-4 text-muted" />
        <p className="flex-1 font-mono text-[11px] text-muted">
          No audio yet — generate with Suno/Udio and paste the URL below
        </p>
        <button
          onClick={() => setShowInput((s) => !s)}
          className="font-mono text-[11px] uppercase tracking-[0.1em] text-current hover:underline"
        >
          {showInput ? "Cancel" : "Add URL"}
        </button>
      </div>
      {showInput && (
        <div className="space-y-2">
          <Input
            label="Audio URL"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://cdn.suno.ai/..."
          />
          {error && <p className="font-mono text-[12px] text-pulse">{error}</p>}
          <Button variant="secondary" loading={saving} onClick={handleSave} className="w-full">
            Save audio URL on-chain
          </Button>
        </div>
      )}
    </div>
  );
}

HEREDOC_5bae396e9574

cat > components/TrackCard.tsx << 'HEREDOC_d9516d4a9e83'
"use client";

import { Music2 } from "lucide-react";
import type { Track } from "@/lib/types";

function ringColor(genre: string) {
  const hash = genre.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return ["#FF2E97", "#00E5FF", "#FFB627"][hash % 3];
}

export function TrackCard({ track, onOpen }: { track: Track; onOpen: (id: string) => void }) {
  const accent = ringColor(track.genre || "x");
  const contribCount = (track.contributors?.length ?? 1);

  return (
    <button
      onClick={() => onOpen(track.id)}
      className="group relative aspect-[4/5] w-full overflow-hidden rounded-md border border-line
        bg-panel p-5 text-left transition-all duration-200 hover:-translate-y-1"
      style={{ boxShadow: "0 0 0 1px rgba(244,238,255,0.06)" }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = `0 0 0 1px ${accent}55, 0 10px 40px ${accent}22`)}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 0 0 1px rgba(244,238,255,0.06)")}
    >
      <div className="absolute inset-0 bg-grain opacity-40" />

      <div className="relative flex h-full flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="led text-[10px] uppercase tracking-[0.16em] text-muted">
              #{track.id} · {track.genre}
            </p>
            {track.audio_url && (
              <Music2 className="h-3 w-3 text-current" title="Audio available" />
            )}
          </div>
          <h3 className="mt-1 font-display text-base font-semibold leading-snug text-ink">
            {track.title}
          </h3>
        </div>

        <p className="line-clamp-3 font-body text-[13px] leading-relaxed text-muted">
          {track.current_content}
        </p>

        <div className="space-y-2">
          {/* Score bar if history exists */}
          {track.history && track.history.length > 1 && track.history[track.history.length - 1].scores && (
            <div className="grid grid-cols-4 gap-1">
              {(["originality","quality","emotional","canon_fit"] as const).map((k) => {
                const score = track.history![track.history!.length - 1].scores![k];
                return (
                  <div key={k} className="space-y-0.5">
                    <div className="h-1 rounded-full bg-line">
                      <div className="h-1 rounded-full bg-current" style={{ width: `${score}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line
                transition-transform duration-300 group-hover:animate-spin-slow"
              style={{ background: `radial-gradient(circle at 50% 50%, ${accent}33 0%, #0F0825 70%)` }}
            >
              <span className="led text-[10px] text-ink">v{track.version}</span>
              <span className="absolute h-1.5 w-1.5 rounded-full bg-void" />
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] text-muted">{track.creator.slice(0, 6)}…</p>
              {contribCount > 1 && (
                <p className="led text-[10px] text-muted/60">{contribCount} contributors</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

HEREDOC_d9516d4a9e83

cat > components/TrackGrid.tsx << 'HEREDOC_25ad7940bac9'
"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { RefreshCw, TrendingUp, Layers, Filter } from "lucide-react";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Track } from "@/lib/types";
import { TrackCard } from "./TrackCard";
import { CreateSeedForm } from "./CreateSeedForm";
import { Button } from "./ui/Button";

type Mode = "all" | "top" | "mine";

export function TrackGrid({ onOpen }: { onOpen: (id: string) => void }) {
  const { isConnected } = useAccount();
  const { listActiveTracks, getTopTracks, getMyTracks, getTrack } = useHarmonyForge();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [genreFilter, setGenreFilter] = useState("");

  async function refresh(m: Mode = mode) {
    if (!isConnected && m === "mine") return;
    setLoading(true);
    try {
      let ids: string[] = [];
      if (m === "top")       ids = await getTopTracks(20);
      else if (m === "mine") ids = await getMyTracks();
      else                   ids = await listActiveTracks();
      const hydrated = await Promise.all(ids.map((id) => getTrack(id)));
      setTracks(
        genreFilter
          ? hydrated.filter((t) => t.genre.toLowerCase().includes(genreFilter.toLowerCase()))
          : hydrated
      );
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isConnected]);

  function switchMode(m: Mode) { setMode(m); refresh(m); }

  const [featured, ...rest] = tracks;

  if (!isConnected) return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-lg text-ink">The deck is dark.</p>
      <p className="max-w-sm font-body text-sm text-muted">
        Connect a wallet to browse the studio.
      </p>
    </div>
  );

  return (
    <div className="space-y-10">
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        {/* Featured */}
        <div className="relative overflow-hidden rounded-md border border-line bg-panel p-8">
          <div className="absolute inset-0 bg-grain opacity-30" />
          <p className="relative font-mono text-[11px] uppercase tracking-[0.18em] text-pulse">Now evolving</p>
          {featured ? (
            <button onClick={() => onOpen(featured.id)} className="relative mt-3 block text-left">
              <h2 className="font-display text-3xl font-bold leading-tight text-ink">{featured.title}</h2>
              <p className="mt-1 led text-xs uppercase tracking-[0.12em] text-muted">
                {featured.genre} · v{featured.version} · #{featured.id}
                {(featured.contributors?.length ?? 1) > 1 && ` · ${featured.contributors!.length} contributors`}
              </p>
              <p className="mt-4 max-w-md font-body text-sm leading-relaxed text-muted line-clamp-4">
                {featured.current_content}
              </p>
            </button>
          ) : (
            <p className="relative mt-3 font-body text-sm text-muted">
              {loading ? "Cueing up the catalog…" : "No tracks yet — press the first seed."}
            </p>
          )}
        </div>
        <CreateSeedForm onCreated={() => refresh()} />
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-sm border border-line overflow-hidden">
          {(["all","top","mine"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                mode === m ? "bg-pulse/20 text-pulse" : "text-muted hover:text-ink"
              }`}
            >
              {m === "all" ? <><Layers className="mr-1 inline h-3 w-3" />All</>
               : m === "top" ? <><TrendingUp className="mr-1 inline h-3 w-3" />Top</>
               : <><Filter className="mr-1 inline h-3 w-3" />Mine</>}
            </button>
          ))}
        </div>
        <input
          value={genreFilter}
          onChange={(e) => setGenreFilter(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && refresh()}
          placeholder="Filter by genre…"
          className="rounded-sm border border-line bg-rail/60 px-3 py-1.5 font-mono text-[11px]
            text-ink placeholder:text-muted/60 focus:border-current/60 focus:outline-none"
        />
        <Button variant="ghost" onClick={() => refresh()} loading={loading} className="!px-3 !py-1.5 ml-auto">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {rest.length === 0 && !loading ? (
        <p className="font-body text-sm text-muted">Nothing else spinning.</p>
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
          {rest.map((t) => <TrackCard key={t.id} track={t} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

HEREDOC_25ad7940bac9

cat > components/TrackDetail.tsx << 'HEREDOC_284cb3082fef'
"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Stamp, ListMusic, Share2, Check } from "lucide-react";
import { useHarmonyForge } from "@/lib/genlayer";
import type { Track } from "@/lib/types";
import { Button } from "./ui/Button";
import { ProposeEvolutionForm } from "./ProposeEvolutionForm";
import { EvaluateProposalButton } from "./EvaluateProposalButton";
import { MintElementModal } from "./MintElementModal";
import { TrackHistory } from "./TrackHistory";
import { AudioPlayer } from "./AudioPlayer";

interface SessionProposal { id: string; type: string; }

export function TrackDetail({ trackId, onBack }: { trackId: string; onBack: () => void }) {
  const { getTrack } = useHarmonyForge();
  const [track, setTrack] = useState<Track | null>(null);
  const [mintOpen, setMintOpen] = useState(false);
  const [sessionProposals, setSessionProposals] = useState<SessionProposal[]>([]);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"content" | "history">("content");

  async function refresh() { setTrack(await getTrack(trackId)); }
  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [trackId]);

  function onProposed(proposalId: string, type: string) {
    setSessionProposals((p) => [...p, { id: proposalId, type }]);
  }

  function handleShare() {
    const url = `${window.location.origin}?track=${trackId}`;
    navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  if (!track) return <p className="font-body text-sm text-muted">Cueing up track #{trackId}…</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em] text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to the deck
        </button>
        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 font-mono text-[11px] text-muted hover:text-ink transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-current" /> : <Share2 className="h-3.5 w-3.5" />}
          {copied ? "Copied!" : "Share"}
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        {/* Main panel */}
        <div className="relative overflow-hidden rounded-md border border-line bg-panel p-8">
          <div className="absolute inset-0 bg-grain opacity-30" />
          <div className="relative space-y-6">
            <div>
              <p className="led text-[11px] uppercase tracking-[0.16em] text-pulse">
                {track.genre} · v{track.version} · #{track.id}
              </p>
              <h1 className="mt-2 font-display text-3xl font-bold leading-tight text-ink">{track.title}</h1>
              <p className="mt-1 font-mono text-[11px] text-muted">
                by {track.creator.slice(0, 8)}…
                {(track.contributors?.length ?? 1) > 1 && (
                  <span className="ml-2 text-muted/60">+{track.contributors!.length - 1} contributors</span>
                )}
              </p>
            </div>

            {/* Tab switcher */}
            <div className="flex gap-1 border-b border-line pb-0">
              {(["content","history"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`pb-2 px-1 font-mono text-[11px] uppercase tracking-[0.1em] border-b-2 transition-colors -mb-px ${
                    tab === t ? "border-pulse text-pulse" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "content" ? (
              <p className="whitespace-pre-wrap font-body text-[15px] leading-relaxed text-ink/90">
                {track.current_content}
              </p>
            ) : (
              <TrackHistory trackId={track.id} />
            )}

            <AudioPlayer
              trackId={track.id}
              audioUrl={track.audio_url || undefined}
              onAudioSet={refresh}
            />

            <Button variant="vinyl" onClick={() => setMintOpen(true)} className="gap-2">
              <Stamp className="h-3.5 w-3.5" />
              Mint v{track.version}
            </Button>
          </div>
        </div>

        {/* Propose + evaluate */}
        <div className="space-y-6">
          <ProposeEvolutionForm trackId={track.id} onProposed={onProposed} />
          <div className="rounded-md border border-line bg-panel/70 p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <ListMusic className="h-4 w-4 text-vinyl" />
              <h4 className="font-display text-sm font-semibold uppercase tracking-[0.1em] text-ink">
                Session proposals
              </h4>
            </div>
            {sessionProposals.length === 0 ? (
              <p className="font-body text-sm text-muted">
                Propose an evolution above — its on-chain ID appears here for jury evaluation.
              </p>
            ) : (
              <ul className="space-y-3">
                {sessionProposals.map((p) => (
                  <li key={p.id}
                    className="flex flex-col gap-2 rounded-sm border border-line/60 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">{p.type}</span>
                      <span className="led text-[10px] text-muted/60">#{p.id}</span>
                    </div>
                    <EvaluateProposalButton proposalId={p.id} onResolved={refresh} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <MintElementModal trackId={track.id} open={mintOpen} onClose={() => setMintOpen(false)} />
    </div>
  );
}

HEREDOC_284cb3082fef

echo ""
echo "✓ 11 files written."
echo ""
echo "Next steps:"
echo "  1. Redeploy HarmonyForge.py in GenLayer Studio"
echo "  2. Update CONTRACT_ADDRESS in lib/genlayer.ts"
echo "  3. git add -A && git commit -m 'feat: v2 hardened contract + frontend upgrade' && git push"
