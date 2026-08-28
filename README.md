# GenHarmony

## Project Summary

Music is usually finished by one person and locked the moment it's released. GenHarmony treats a track as a living, collectively-owned artifact instead: anyone can seed an idea, anyone can propose an evolution, and an on-chain LLM jury — not a single gatekeeper — decides what actually becomes canon. Contributors are rewarded in GEN proportional to how well their work scores, and provenance (who contributed what, and when) is permanent and on-chain.

This is only possible on GenLayer. A standard EVM chain can't run subjective judgment — "is this a good remix?" has no deterministic answer a normal smart contract can compute. GenLayer's Intelligent Contracts can call an LLM directly from contract code and reach consensus on a subjective decision through Optimistic Democracy, where independent validators re-run the same judgment and must agree on the outcome before it's written to state. GenHarmony's `evaluate_proposal` method is a direct, working example of that: the contract literally asks an LLM whether a piece of music is good, and multiple validators independently check that verdict before it's trusted.

## Live Demo

**App:** [gen-harmonydr.vercel.app](https://gen-harmonydr.vercel.app/)

Connect an injected wallet (MetaMask or similar) and switch to the GenLayer Studio network when prompted — the app will request the switch automatically on your first write action.

## Contract Details

| | |
|---|---|
| Network | GenLayer Studio |
| Chain ID | `61999` |
| RPC URL | `https://studio.genlayer.com:8443/api` |
| Contract address | `0xAEd779184A62B4901B45Be24f04500a8F6Fe44Fa` |
| Contract source | [`genharmony/contracts/harmonyforge.py`](./genharmony/contracts/harmonyforge.py) |
| Explorer | [View on GenLayer Studio Explorer](https://explorer-studio.genlayer.com/address/0xAEd779184A62B4901B45Be24f04500a8F6Fe44Fa) |

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React, TypeScript, Tailwind CSS
- **Wallet / chain:** wagmi, viem, `genlayer-js` (GenLayer's official client SDK)
- **Contract:** Python Intelligent Contract on GenLayer VM (`gl.Contract`), using `gl.nondet.exec_prompt` for LLM calls and `gl.vm.run_nondet_unsafe` for Optimistic Democracy consensus
- **Storage:** on-chain contract state only (`TreeMap` + JSON-encoded records) — no external database
- **Identity:** a per-browser GenLayer key generated on first visit and stored in `localStorage`, used to sign contributor transactions (see Known Limitations)
- **Hosting:** Vercel

## How It Works

1. **Seed a track** — `submit_seed(title, seed_prompt, genre)` creates a new track on-chain with `version = 0`.
2. **Propose an evolution** — any contributor calls `propose_evolution(track_id, target_element, musical_relationship, key_terms, contribution_type, audio_url, audio_hash)`, submitting a structured, content-addressed artifact rather than free text. `audio_url`/`audio_hash` are optional (both empty, or both provided — the contract rejects a lone URL or a lone hash) and let a contributor reference a real audio file: `audio_hash` is a SHA-256 digest of the actual audio bytes, computed client-side before submission. The contract folds all four fields — including `audio_hash` when present — into a single `artifact_hash`, pinning the exact proposal (text and, if provided, the specific audio file referenced) that gets judged, so none of it can be silently altered before evaluation. The LLM jury is instructed to check that its scores and any merged content genuinely correspond to the stated `key_terms`, rather than approving on the strength of vague or generic framing — and, separately, is explicitly told that the mere presence of an audio reference is not evidence of quality or correspondence, since it has no ability to listen to or analyze it (see Known Limitations).
3. **Convene the jury** — `evaluate_proposal(proposal_id)` triggers the LLM jury:
   - A **leader** validator fetches fresh reference context (a genre Wikipedia page and a music-terminology glossary page) and calls the LLM once with a prompt built from that context, the track, and the proposed contribution — getting back a JSON verdict: an `approve` decision, four 0–100 scores (quality, originality, emotional, canon fit), merged content, and a rationale. Both the context fetches and the LLM call happen inside the leader/validator equivalence-principle path, not before it — every `gl.nondet` call the jury makes is one validators can independently re-run and compare against, not a pre-computed value shared across the round.
   - Every other **validator** independently re-fetches the same reference context and re-runs the identical LLM prompt, forming its own verdict. Consensus requires: the validator's `approve`/`reject` decision matches the leader's; each of the four individual scores (quality, originality, emotional, canon fit) is within `SCORE_TOLERANCE` (10 points) of the leader's — checked per-score, not just as a composite average; and, on approval, the leader's proposed canon content shares at least half its significant terms with what the validator itself independently generated for the same prompt (`MIN_CONTENT_OVERLAP_RATIO`), on top of a separate check that the content genuinely derives from the original track and contribution rather than being fabricated.
   - The contract only merges the evolution into canon if **both** the LLM's own `approve` decision is `true` **and** the composite score clears `APPROVAL_THRESHOLD` (currently 55/100).
4. **Merge or reject** — on approval, `track.current_content` is updated, `track.version` increments, and a GEN reward is credited to the contributor (pull-payment pattern via `claim_rewards`). On rejection, the proposal is marked rejected and the track is untouched.
5. **Mint** — any contributor can mint the current version of a track as a provenance-tracked element (`mint_element`), paying GEN into the shared treasury.

## How to Run Locally

```bash
git clone <this repo>
cd genharmony
npm install
```

No environment variables are required — the contract address and GenLayer Studio RPC URL are hardcoded in `lib/genlayer.ts` for this deployment. To point at a different deployed contract, update `CONTRACT_ADDRESS` in that file.

```bash
npm run dev     # local dev server, http://localhost:3000
npm run build   # production build
npm run start   # run the production build locally
```

## Demo Evidence

Paste these directly into the app to test end-to-end quickly.

**Seed a track:**
| Field | Value |
|---|---|
| Title | Ash Wednesday Radio |
| Genre | Post-rock |
| Prompt | A church organ recorded through a broken transistor radio. The static isn't noise — it's the only part of the recording that sounds honest. |

**Strong evolution (should be approved):**
| Field | Value |
|---|---|
| Target element | Second organ voice |
| Musical relationship | Layer a second organ voice a fifth below the main line, recorded through even worse static than the original — degraded enough that it's barely a pitch, more a suggestion of one. Let it enter only once, under the final phrase, then cut hard to silence. |
| Key terms | organ, fifth interval, static degradation, single entrance, final phrase, hard cut |

**Weak evolution (should be rejected):**
| Field | Value |
|---|---|
| Target element | vibe |
| Musical relationship | i like this song its nice and calm good vibes |
| Key terms | nice, calm |

Submitting the weak version and convening the jury should return a **Rejected** verdict with a low composite score — this is the clearest single test of whether the jury is discriminating on quality rather than rubber-stamping everything.

## Known Limitations

Being direct about these rather than glossing over them:

- **LLM jury latency.** Evaluation takes roughly 30–90 seconds per proposal (one leader call plus independent validator re-runs). The UI polls for the result; there is no push notification.
- **Contributor identity is a browser-local key, not a full wallet.** To work around GenLayer Studio's transaction format not being signable by MetaMask directly, each browser generates and stores its own GenLayer signing key in `localStorage` on first visit. This means identity is tied to a browser/device, not portable across devices, and would need to be replaced with proper wallet-based signing (e.g. a MetaMask Snap, once stable) before this could be considered production-ready.
- **Audio is not on-chain.** Audio URLs pasted into the player are stored in the browser's `localStorage`, keyed per track version — not written to the contract. This is a UI convenience only and does not persist across browsers/devices, and is lost if local storage is cleared.
- **Track history is reconstructed client-side, not stored as a first-class contract record.** The contract does not currently store a per-track history array; the frontend derives version history by scanning all proposals and filtering for ones that belong to the track and were approved. This works correctly at demo scale but scales linearly with total proposals across the whole contract, not just the one track — a production version should add a dedicated `get_track_history` view backed by real on-chain storage.
- **Audio can now be content-addressed, but still not musically verified.** A proposal can optionally reference a real audio file: the contributor's browser computes a SHA-256 hash of the actual audio bytes (`audio_hash`), which is folded into `artifact_hash` alongside the text fields and an `audio_url` for playback. This is a genuine integrity binding — it proves which exact file was referenced and that it wasn't swapped after submission. It is **not** musical verification: GenVM cannot decode, play, or analyze audio content in any way, so correspondence, provenance, and originality judgments are still made by the LLM jury from the text fields alone. The jury prompt explicitly instructs jurors that an audio reference's mere presence is not evidence of quality, originality, or correspondence — this is enforced in the prompt, not just documented here, to prevent an unlistenable attachment from being treated as a positive signal.
- **Provenance and originality are LLM-judgment-only, not verified against real evidence.** The jury's external context is two fixed, best-effort fetches: a Wikipedia page for the track's genre, and a general music-terminology glossary page, both fetched by URL (GenVM has no search capability - it can only render a specific, already-known page, not look anything up). This gives the LLM a somewhat richer reference for judging whether a proposal's key terms are used in a musically coherent way, but it remains fundamentally an LLM's best-effort judgment, not a real plagiarism or similarity detection system - it cannot search for or verify whether a musical idea traces back to any genuine external source. Adding more fixed sources could not change this, since the underlying limitation is the absence of search, not the number of pages fetched.
- **Testnet only.** This is deployed on GenLayer Studio, not a production GenLayer network. Contract state can be reset by redeployment, and gas/economics are not representative of mainnet conditions.
- **Reward formula is a simple quadratic curve**, not economically tuned — it exists to demonstrate the pull-payment reward mechanism working end-to-end, not as a finished tokenomics model.

## Future Roadmap

**Phase 2**
- Replace the localStorage signing key with proper wallet-based signing once GenLayer's browser wallet / Snap integration is stable
- Add a real `get_track_history` view to the contract so version history is a first-class on-chain record instead of a client-side reconstruction
- Store audio references on-chain (or via a decentralized storage pointer) instead of localStorage

**Phase 3**
- Multi-track "album" grouping and cross-track collaboration
- Configurable per-track approval thresholds and reward curves, set by the track's original creator
- A real plagiarism/similarity detection pass distinct from the artistic-quality jury
- Governance over contract parameters (`APPROVAL_THRESHOLD`, reward curve, royalty split) via a DAO-style vote rather than owner-only `update_config`
