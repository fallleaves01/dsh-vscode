export interface SecretMatch { id: 'secret'; start: number; end: number; data: { masked: string } }
export function createSecretRule(): { id: string; order: number; match(text: string, from: number): SecretMatch | undefined }
