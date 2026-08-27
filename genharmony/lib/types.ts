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
  target_element: string;
  musical_relationship: string;
  key_terms: string;
  audio_url?: string;
  audio_hash?: string;
  artifact_hash: string;
  contribution_type: string;
  status: "pending" | "approved" | "rejected" | "stale";
  scores: ProposalScores | null;
  evolved_content: string | null;
  rationale: string | null;
  track_version: number;
}

export interface MintedElement {
  id: string;
  track_id: string;
  kind: string;
  owner: string;
  version_at_mint: number;
}
