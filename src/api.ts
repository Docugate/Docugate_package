import { loadCredentials, saveCredentials } from './auth.js'

/** Module-level default, captured at import time (used by CLI commands). */
export const BASE_URL = process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'

const ERROR_MESSAGES: Record<string, string> = {
  pro_required_sources: 'Connecting more than one repository to a space needs DocuGate Pro',
  space_limit: 'The free plan has one space. Connect this repository to it, or upgrade to Pro',
  pro_required: 'Private repositories need DocuGate Pro',
  no_repo_access: "DocuGate can't see this repository. Install the DocuGate GitHub App on it first",
  slug_taken: 'You already have a space with this name',
  repo_exists: 'You already have a repository with this name on GitHub',
  app_permission: "DocuGate's GitHub App has not been allowed to create repositories yet",
  github_required: 'Sign in with GitHub to create a space',
}

function friendlyError(code: string): string {
  return ERROR_MESSAGES[code] ?? `DocuGate said: ${code}`
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const creds = loadCredentials()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }
  if (creds) {
    headers['Authorization'] = `Bearer ${creds.token}`
  }

  // Re-read the env at call time so tests that set DOCUGATE_URL after import work.
  const base = process.env.DOCUGATE_URL ?? 'https://www.trydocugate.site'
  const res = await fetch(`${base}${path}`, { ...init, headers })

  // Renew token if the server sent a fresh one.
  const renewed = res.headers.get('x-docugate-token')
  if (renewed) saveCredentials(renewed)

  if (res.status === 401) {
    throw new Error('Run docugate login')
  }

  if (!res.ok) {
    let code: string | undefined
    try {
      const body = await res.clone().json() as unknown
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const b = body as Record<string, unknown>
        if (typeof b.error === 'string') code = b.error
      }
    } catch {
      // ignore JSON parse failure
    }
    if (code) throw Object.assign(new Error(friendlyError(code)), { code })
    throw new Error(`DocuGate request failed with status ${res.status}`)
  }

  return res
}

// ---------------------------------------------------------------------------
// Typed wrappers
// ---------------------------------------------------------------------------

export interface DocugateUser {
  githubLogin: string
  name: string
  email: string
  plan: string
}

export interface SessionResponse {
  user: DocugateUser | null
}

export interface Space {
  id: string
  owner: string
  slug: string
  name: string
  /** The repositories the space reads from. */
  sources?: Array<{ repo: string }>
}

export interface SpacesResponse {
  spaces: Space[]
}

export async function getSession(): Promise<SessionResponse> {
  const res = await apiFetch('/api/auth/session')
  return res.json() as Promise<SessionResponse>
}

export async function getSpaces(): Promise<SpacesResponse> {
  const res = await apiFetch('/api/spaces/mine')
  return res.json() as Promise<SpacesResponse>
}

export async function createSpace(repo: string, name: string, docsDir: string): Promise<Space> {
  const res = await apiFetch('/api/spaces', {
    method: 'POST',
    body: JSON.stringify({ repo, name, docsDir }),
  })
  return ((await res.json()) as { space: Space }).space
}

/** Creates an empty repository on the person's GitHub account, as them. */
export async function createRepo(name: string, isPrivate: boolean): Promise<{ repo: string; url: string; cloneUrl: string }> {
  const res = await apiFetch('/api/repos', {
    method: 'POST',
    body: JSON.stringify({ name, private: isPrivate }),
  })
  return (await res.json()) as { repo: string; url: string; cloneUrl: string }
}

export async function connectRepo(spaceId: string, repo: string, docsDir: string): Promise<void> {
  await apiFetch(`/api/spaces/${spaceId}/sources`, {
    method: 'POST',
    body: JSON.stringify({ repo, docsDir }),
  })
}
