export type ArtifactType = "video" | "photo" | "evp" | "sensor-log" | "finding" | "note";

export const ARTIFACT_TYPES: { key: ArtifactType; label: string; section: string }[] = [
  { key: "video", label: "Video", section: "video/" },
  { key: "photo", label: "Photos", section: "photos/" },
  { key: "evp", label: "EVP", section: "evp/" },
  { key: "sensor-log", label: "Sensor logs", section: "sensor-logs/" },
  { key: "finding", label: "Findings", section: "findings/" },
  { key: "note", label: "Notes", section: "notes/" },
];

export type Verdict = "agrees" | "disagrees" | "uncertain";

export const VERDICTS: { key: Verdict; label: string }[] = [
  { key: "agrees", label: "Agrees" },
  { key: "disagrees", label: "Disagrees" },
  { key: "uncertain", label: "Uncertain" },
];

export interface Artifact {
  artifact_id: string;
  type: ArtifactType;
  original_name: string;
  stored_as: string;
  sha256: string;
  size_bytes: number;
  ingested_utc: string;
  source: string;
  note?: string;
  /** Second-pass attestations: artifact_id of the finding under review. */
  attestation_of?: string;
  verdict?: Verdict;
  analyst?: string;
}

export interface CaseManifest {
  schema_version: string;
  case_id: string;
  name: string;
  created_utc: string;
  closed_utc: string | null;
  status: "open" | "closed";
  artifacts: Artifact[];
}

export interface CaseSummary {
  case_id: string;
  name: string;
  status: "open" | "closed";
  created_utc: string;
  closed_utc: string | null;
  artifact_count: number;
  size_bytes: number;
}

export interface VerifyEntry {
  artifact_id: string;
  stored_as: string;
  status: "ok" | "missing" | "mismatch" | "escaped";
}

export interface VerifyReport {
  case_id: string;
  checked_utc: string;
  ok: boolean;
  artifacts: VerifyEntry[];
}

export interface ReviewInput {
  verdict: Verdict;
  note?: string;
  analyst?: string;
}

export interface FindingInput {
  source_artifact_id: string;
  t_start: number;
  t_end: number;
  region?: string;
  note?: string;
  analyst?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export function rawUrl(caseId: string, storedAs: string): string {
  const path = storedAs.split("/").map(encodeURIComponent).join("/");
  return `/api/cases/${caseId}/raw/${path}`;
}

export function archiveUrl(caseId: string): string {
  return `/api/cases/${caseId}/archive`;
}

export const api = {
  listCases: () => request<CaseSummary[]>("/api/cases"),
  getCase: (id: string) => request<CaseManifest>(`/api/cases/${id}`),
  createCase: (name: string) => request<CaseManifest>("/api/cases", json({ name })),
  upload: (id: string, file: File, kind?: ArtifactType) => {
    const params = new URLSearchParams({ name: file.name, source: "tara-ui" });
    if (kind) params.set("kind", kind);
    return request<Artifact>(`/api/cases/${id}/artifacts?${params.toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });
  },
  addNote: (id: string, title: string, text: string, analyst: string) =>
    request<Artifact>(`/api/cases/${id}/notes`, json({ title, text, analyst })),
  addFinding: (id: string, input: FindingInput) =>
    request<Artifact>(`/api/cases/${id}/findings`, json(input)),
  addReview: (id: string, findingId: string, input: ReviewInput) =>
    request<Artifact>(`/api/cases/${id}/findings/${findingId}/reviews`, json(input)),
  closeCase: (id: string) =>
    request<{ case_id: string; status: string; archive: string; closed_utc: string }>(
      `/api/cases/${id}/close`,
      { method: "POST" },
    ),
  verify: (id: string) => request<VerifyReport>(`/api/cases/${id}/verify`),
  rawText: async (caseId: string, storedAs: string): Promise<string> => {
    const res = await fetch(rawUrl(caseId, storedAs));
    if (!res.ok) throw new Error(`could not load artifact (${res.status})`);
    return res.text();
  },
  rawJson: async (caseId: string, storedAs: string): Promise<Record<string, unknown>> => {
    const res = await fetch(rawUrl(caseId, storedAs));
    if (!res.ok) throw new Error(`could not load artifact (${res.status})`);
    return res.json();
  },
};
