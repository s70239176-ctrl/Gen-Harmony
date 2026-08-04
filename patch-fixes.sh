#!/usr/bin/env bash
set -e
echo "→ Patching contracts/HarmonyForge.py and lib/genlayer.ts..."
mkdir -p contracts

cat > contracts/HarmonyForge.py << 'HEREDOC_7affcbc33f2e'
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
APPROVAL_THRESHOLD = 60      # composite score (0-100) required to merge an evolution
MAX_REWARD_BPS    = u256(1000)   # hard cap: 10.00% of available treasury per approval
BPS_DENOMINATOR   = u256(10000)
MIN_REWARD_WEI    = u256(10_000_000_000_000_000)  # 0.01 GEN (18-decimal wei)
SCORE_TOLERANCE   = 20       # validators accept leader if per-axis delta <= this


class HarmonyForge(gl.Contract):
    # ---- identity ----
    owner: Address

    # ---- counters ----
    next_track_id:    u256
    next_proposal_id: u256
    next_element_id:  u256

    # ---- treasury ----
    treasury_locked: u256

    # ---- contributor accounting ----
    pending_rewards:    TreeMap[Address, u256]
    contribution_count: TreeMap[Address, u256]

    # ---- primary storage (JSON blobs) ----
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
    # Track lifecycle: create, evolve, fork
    # ------------------------------------------------------------------
    @gl.public.write
    def submit_seed(self, title: str, seed_prompt: str, genre: str) -> str:
        """Create a new track from a musical seed prompt."""
        if not seed_prompt.strip():
            raise gl.vm.UserError("seed_prompt cannot be empty")

        track_id = str(self.next_track_id)
        self.next_track_id = self.next_track_id + u256(1)

        track = {
            "id":              track_id,
            "title":           title,
            "genre":           genre,
            "creator":         str(gl.message.sender_address),
            "status":          "active",
            "current_content": seed_prompt,
            "version":         0,
            "parent_track_id": None,
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

        forked = {
            "id":              track_id,
            "title":           new_title,
            "genre":           parent["genre"],
            "creator":         str(gl.message.sender_address),
            "status":          "active",
            "current_content": parent["current_content"],
            "version":         0,
            "parent_track_id": parent_track_id,
        }
        self.tracks[track_id] = json.dumps(forked)
        return track_id

    @gl.public.write
    def propose_evolution(self, track_id: str, contribution_text: str, contribution_type: str) -> str:
        """Queue a remix/harmony/variation proposal for an active track.

        The proposer's address (gl.message.sender_address) is recorded on-chain
        at proposal time. All subsequent canon credit and reward payout target
        this address exclusively — ownership is tied to the submitting account,
        not to any shared key.
        """
        raw = self.tracks.get(track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"unknown track_id: {track_id}")
        track = json.loads(raw)
        if track["status"] != "active":
            raise gl.vm.UserError(f"track {track_id} is not active (status={track['status']})")
        if not contribution_text.strip():
            raise gl.vm.UserError("contribution_text cannot be empty")

        proposal_id = str(self.next_proposal_id)
        self.next_proposal_id = self.next_proposal_id + u256(1)

        proposal = {
            "id":                proposal_id,
            "track_id":          track_id,
            # Locked to the submitting address — not changeable after submission.
            "proposer":          str(gl.message.sender_address),
            "contribution_text": contribution_text,
            "contribution_type": contribution_type,
            "status":            "pending",
            "scores":            None,
            "evolved_content":   None,
            "rationale":         None,
        }
        self.proposals[proposal_id] = json.dumps(proposal)
        return proposal_id

    # ------------------------------------------------------------------
    # LLM-powered evaluation — Optimistic Democracy
    #
    # FIX 1: validators now INDEPENDENTLY re-run the full LLM judgment
    # (same prompt, same web context) and accept the leader's result only
    # if every per-axis score delta is within SCORE_TOLERANCE AND the
    # approve/reject decision matches. Structural checks alone are not
    # sufficient — the validator must form its own artistic opinion.
    # ------------------------------------------------------------------
    @gl.public.write
    def evaluate_proposal(self, proposal_id: str) -> str:
        """Run independent LLM juries and merge if the consensus approves."""
        raw_proposal = self.proposals.get(proposal_id, None)
        if raw_proposal is None:
            raise gl.vm.UserError(f"unknown proposal_id: {proposal_id}")
        proposal = json.loads(raw_proposal)
        if proposal["status"] != "pending":
            raise gl.vm.UserError(f"proposal {proposal_id} already evaluated")

        raw_track = self.tracks.get(proposal["track_id"], None)
        if raw_track is None:
            raise gl.vm.UserError(f"track for proposal {proposal_id} no longer exists")
        track = json.loads(raw_track)

        verdict   = self._judge_evolution(track, proposal)
        composite = (
            verdict["originality"] + verdict["quality"] +
            verdict["emotional"]   + verdict["canon_fit"]
        ) // 4

        if (not verdict["approve"]) or composite < APPROVAL_THRESHOLD:
            proposal["status"]   = "rejected"
            proposal["scores"]   = verdict
            proposal["rationale"]= verdict["rationale"]
            self.proposals[proposal_id] = json.dumps(proposal)
            return json.dumps({
                "proposal_id":     proposal_id,
                "status":          "rejected",
                "composite_score": composite,
            })

        # --- merge into canon ---
        track["current_content"] = verdict["evolved_content"]
        track["version"]         = track["version"] + 1
        self.tracks[track["id"]] = json.dumps(track)

        proposal["status"]         = "approved"
        proposal["scores"]         = verdict
        proposal["evolved_content"]= verdict["evolved_content"]
        proposal["rationale"]      = verdict["rationale"]
        self.proposals[proposal_id]= json.dumps(proposal)

        # Credit reward to the proposer's own address (recorded at submission)
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
            "proposal_id":     proposal_id,
            "status":          "approved",
            "composite_score": composite,
            "new_version":     track["version"],
            "reward_credited": str(reward),
            "credited_to":     str(contributor_addr),
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
        """Withdraw earned GEN to the caller's wallet.

        FIX 2: The contract transfers GEN to the claimant BEFORE zeroing the
        entitlement.  If gl.transfer reverts (e.g. insufficient balance), the
        entire transaction rolls back — pending_rewards is never cleared for a
        failed payout.  This guarantees the claimant cannot lose their
        entitlement without receiving the tokens.

        Order of operations
        -------------------
        1. Read & validate the claimant's balance.
        2. Execute gl.transfer — moves GEN from contract to claimant.
           If this fails the tx reverts here, state unchanged.
        3. Only after the transfer succeeds: zero the entitlement and
           release treasury_locked.
        """
        claimant = gl.message.sender_address
        amount   = self.pending_rewards.get(claimant, u256(0))

        if amount == u256(0):
            raise gl.vm.UserError("no pending rewards to claim")
        if self.balance < amount:
            raise gl.vm.UserError("treasury balance temporarily insufficient — try again later")

        # STEP 2 — transfer GEN first; reverts here on failure, state unchanged
        gl.transfer(claimant, amount)

        # STEP 3 — only reached if transfer succeeded
        self.pending_rewards[claimant] = u256(0)
        self.treasury_locked = (
            self.treasury_locked - amount
            if self.treasury_locked >= amount
            else u256(0)
        )

        return f"transferred {amount} wei to {claimant}"

    # ------------------------------------------------------------------
    # Minting
    # ------------------------------------------------------------------
    @gl.public.write.payable
    def mint_element(self, track_id: str, kind: str) -> str:
        """Mint a track element as an owned provenance-tracked record."""
        raw = self.tracks.get(track_id, None)
        if raw is None:
            raise gl.vm.UserError(f"unknown track_id: {track_id}")
        track = json.loads(raw)
        if gl.message.value == u256(0):
            raise gl.vm.UserError("send GEN with this call to mint an element")

        element_id = str(self.next_element_id)
        self.next_element_id = self.next_element_id + u256(1)

        record = {
            "id":             element_id,
            "track_id":       track_id,
            "kind":           kind,
            "owner":          str(gl.message.sender_address),
            "version_at_mint": track["version"],
        }
        self.minted_elements[element_id] = json.dumps(record)
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
        """Return track IDs whose status is active."""
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
        """Return the ids of all minted elements owned by the caller."""
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

    # ------------------------------------------------------------------
    # Internal: treasury accounting
    # ------------------------------------------------------------------
    def _available_treasury(self) -> u256:
        bal = self.balance
        if bal <= self.treasury_locked:
            return u256(0)
        return bal - self.treasury_locked

    def _calculate_reward(self, composite_score: int) -> u256:
        """Quadratic reward: higher scores earn a disproportionately larger share.
        Hard cap: MAX_REWARD_BPS (10%) of available treasury per approval.
        Floor: MIN_REWARD_WEI (0.01 GEN) for any approved contribution."""
        available = self._available_treasury()
        if available == u256(0):
            return u256(0)

        capped    = max(0, min(100, composite_score))
        score_sq  = u256(capped * capped)                              # 0-10000
        max_slice = (available * MAX_REWARD_BPS) // BPS_DENOMINATOR   # 10% cap
        reward    = (max_slice * score_sq) // u256(10000)

        if reward > max_slice:
            reward = max_slice
        if reward < MIN_REWARD_WEI:
            reward = MIN_REWARD_WEI if available >= MIN_REWARD_WEI else available
        return reward

    # ------------------------------------------------------------------
    # Internal: nondet LLM jury + web context
    #
    # FIX 1 (continued): validator_fn independently calls the same LLM
    # with the same prompt and web context as the leader. It forms its own
    # artistic verdict and only returns True (accept) if:
    #   a) the approve/reject decision is identical, AND
    #   b) every per-axis score is within SCORE_TOLERANCE of the leader's.
    # This ensures artistic consensus is real, not just structural.
    # ------------------------------------------------------------------
    def _fetch_web_context(self, url: str = "") -> str:
        """Best-effort web fetch; empty on any failure."""
        if not url:
            return ""
        try:
            return gl.nondet.web.render(url, mode="text")[:2000]
        except Exception:
            return ""

    def _build_judgment_prompt(self, track: dict, proposal: dict, context: str) -> str:
        return f"""You are the artistic jury for HarmonyForge, a collaborative on-chain
music-evolution project. Judge whether the PROPOSED CONTRIBUTION should be merged
into the TRACK's canon, and produce the merged result if it should be.

TRACK TITLE: {track['title']}
GENRE: {track['genre']}
CURRENT CANON CONTENT: {track['current_content']}
CONTRIBUTION TYPE: {proposal['contribution_type']}
PROPOSED CONTRIBUTION: {proposal['contribution_text']}
WEB CONTEXT (may be empty): {context}

Score 0-100 on each axis, decide approve/reject, and if approving write the
new merged track content that folds the contribution into the existing canon.

Return ONLY a JSON object with exactly these keys:
- "approve": boolean
- "quality": integer 0-100
- "originality": integer 0-100
- "emotional": integer 0-100
- "canon_fit": integer 0-100
- "evolved_content": string (merged content if approved, else "")
- "rationale": string (<= 280 chars)"""

    def _judge_evolution(self, track: dict, proposal: dict) -> dict:
        # Pre-compute the context once so both leader and validator use identical input.
        genre   = track.get("genre", "")
        url     = ("https://en.wikipedia.org/wiki/" + genre.strip().replace(" ", "_")) if genre else ""
        context = self._fetch_web_context(url)
        prompt  = self._build_judgment_prompt(track, proposal, context)

        def leader_fn():
            result = gl.nondet.exec_prompt(prompt, response_format="json")
            if not isinstance(result, dict):
                raise gl.vm.UserError("leader judge returned a non-dict response")
            return result

        def validator_fn(leader_result) -> bool:
            """
            Validators DO NOT merely check the shape of the leader's result.
            They independently call the LLM with the identical prompt and
            compare their own verdict to the leader's on every axis.

            Acceptance criteria:
              1. Leader result is structurally valid (right keys, right types).
              2. Validator's independent approve/reject decision matches leader's.
              3. Each per-axis score is within SCORE_TOLERANCE of the leader's.
            """
            if not isinstance(leader_result, gl.vm.Return):
                return False
            d = leader_result.calldata
            if not isinstance(d, dict):
                return False

            score_keys = ("quality", "originality", "emotional", "canon_fit")

            # --- structural check ---
            if not isinstance(d.get("approve"), bool):
                return False
            if not isinstance(d.get("evolved_content"), str):
                return False
            if not isinstance(d.get("rationale"), str):
                return False
            for k in score_keys:
                if not isinstance(d.get(k), int) or not (0 <= d[k] <= 100):
                    return False

            # --- independent artistic re-judgment ---
            try:
                validator_verdict = gl.nondet.exec_prompt(prompt, response_format="json")
            except Exception:
                return False

            if not isinstance(validator_verdict, dict):
                return False

            # Decision must match
            if validator_verdict.get("approve") != d.get("approve"):
                return False

            # Per-axis scores must be within tolerance
            for k in score_keys:
                vv = validator_verdict.get(k)
                lv = d.get(k)
                if not isinstance(vv, int) or not isinstance(lv, int):
                    return False
                if abs(vv - lv) > SCORE_TOLERANCE:
                    return False

            return True

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

HEREDOC_7affcbc33f2e

cat > lib/genlayer.ts << 'HEREDOC_761f3866a387'
"use client";

import { defineChain } from "viem";
import { createConfig, http, useWalletClient, useAccount } from "wagmi";
import { injected } from "wagmi/connectors";
import { useCallback, useMemo } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import type { Track, Proposal, MintedElement } from "./types";

// ---------------------------------------------------------------------------
// wagmi config — wallet connection UI
// ---------------------------------------------------------------------------
export const genLayerStudio = defineChain({
  id: 61_999,
  name: "GenLayer Studio",
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [genLayerStudio],
  connectors: [injected()],
  transports: { [genLayerStudio.id]: http() },
});

export const CONTRACT_ADDRESS =
  "0x3F51358206490CcB8eDD2D40Fd8bb42bCd39F363" as const;

// ---------------------------------------------------------------------------
// Safe coercion — readContract may return string or already-parsed value
// ---------------------------------------------------------------------------
function coerce<T>(v: unknown): T {
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return v as unknown as T; }
  }
  return v as unknown as T;
}

// ---------------------------------------------------------------------------
// useHarmonyForge
//
// FIX 3: Writes are signed by the CONNECTED wallet (via wagmi useWalletClient),
// not a shared environment-variable key. Each contributor signs their own
// transactions — canon credit and reward payouts go to their address.
//
// genlayer-js createClient accepts any viem Account. wagmi's walletClient.account
// is a viem Account backed by the injected provider (MetaMask / browser wallet),
// so passing it directly gives per-user signing without exposing any private key.
// ---------------------------------------------------------------------------
export function useHarmonyForge() {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient({ config: wagmiConfig });

  // ---- reads — no wallet needed ----------------------------------------
  const read = useCallback(
    async <T,>(functionName: string, args: unknown[] = []): Promise<T> => {
      const client = createClient({ chain: studionet });
      const result = await client.readContract({
        address: CONTRACT_ADDRESS,
        functionName,
        args: args as never[],
      });
      return coerce<T>(result);
    },
    [],
  );

  // ---- writes — signed by the connected wallet -------------------------
  const write = useCallback(
    async (
      functionName: string,
      args: unknown[] = [],
      value = BigInt(0),
    ): Promise<{ txHash: string; result: unknown }> => {
      if (!walletClient?.account) {
        throw new Error("No wallet connected — please connect first.");
      }

      // Pass the wagmi wallet client's viem Account directly to genlayer-js.
      // This routes signing through the user's browser wallet (MetaMask etc.)
      // rather than any shared private key.
      const client = createClient({
        chain: studionet,
        account: walletClient.account,
      });

      const txHash = await client.writeContract({
        account: walletClient.account,
        address: CONTRACT_ADDRESS,
        functionName,
        args: args as never[],
        value,
      });

      const receipt = await client.waitForTransactionReceipt({
        hash: txHash,
        status: TransactionStatus.ACCEPTED,
      });

      const result =
        (receipt as unknown as Record<string, unknown>).result ?? txHash;
      return { txHash: txHash as string, result };
    },
    [walletClient],
  );

  // ---- public API -------------------------------------------------------
  return useMemo(
    () => ({
      // writes
      submitSeed: (title: string, seedPrompt: string, genre: string) =>
        write("submit_seed", [title, seedPrompt, genre])
          .then(({ result }) => coerce<string>(result)),

      proposeEvolution: (trackId: string, text: string, type: string) =>
        write("propose_evolution", [trackId, text, type])
          .then(({ result }) => coerce<string>(result)),

      forkTrack: (parentTrackId: string, newTitle: string) =>
        write("fork_track", [parentTrackId, newTitle])
          .then(({ result }) => coerce<string>(result)),

      evaluateProposal: (proposalId: string) =>
        write("evaluate_proposal", [proposalId])
          .then(({ txHash }) => txHash),

      fundTreasury: (valueWei: bigint) =>
        write("fund_treasury", [], valueWei).then(({ txHash }) => txHash),

      claimRewards: () =>
        write("claim_rewards", []).then(({ txHash }) => txHash),

      mintElement: (trackId: string, kind: string, valueWei: bigint) =>
        write("mint_element", [trackId, kind], valueWei)
          .then(({ result }) => coerce<string>(result)),

      // reads
      getTrack: (trackId: string) =>
        read<Track>("get_track", [trackId]),
      getProposal: (proposalId: string) =>
        read<Proposal>("get_proposal", [proposalId]),
      listActiveTracks: () =>
        read<string[]>("list_active_tracks", []),
      getPendingRewards: (addr: string) =>
        read<unknown>("get_pending_rewards", [addr]).then(String),
      getTreasuryBalance: () =>
        read<unknown>("get_treasury_balance", []).then(String),
      getContributionCount: (addr: string) =>
        read<unknown>("get_contribution_count", [addr]).then(String),
      getMyMintedElements: () =>
        read<string[]>("get_my_minted_elements", []),
      getMintedElement: (elementId: string) =>
        read<MintedElement>("get_minted_element", [elementId]),
    }),
    [read, write],
  );
}

HEREDOC_761f3866a387

echo "✓ Done. Verifying..."
echo "--- exec_prompt occurrences (expect 2) ---"
grep -n "exec_prompt" contracts/HarmonyForge.py

echo "--- transfer before state clear ---"
grep -n "gl.transfer\|pending_rewards\[claimant\] = u256(0)" contracts/HarmonyForge.py

echo "--- wallet signing (expect walletClient, no PRIVATE_KEY) ---"
grep -n "walletClient\|PRIVATE_KEY" lib/genlayer.ts
