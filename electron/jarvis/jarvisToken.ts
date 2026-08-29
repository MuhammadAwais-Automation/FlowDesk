import { AccessToken } from 'livekit-server-sdk'

export interface CreateTokenParams {
  apiKey: string
  apiSecret: string
  roomName: string
  participantIdentity: string
  participantName?: string
}

export async function createLivekitToken(params: CreateTokenParams): Promise<string> {
  if (!params.apiKey || !params.apiSecret) {
    throw new Error('LiveKit API Key and Secret are required to generate an access token.')
  }

  const at = new AccessToken(params.apiKey, params.apiSecret, {
    identity: params.participantIdentity,
    name: params.participantName || params.participantIdentity,
    ttl: '3h',
  })

  at.addGrant({
    roomJoin: true,
    room: params.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  })

  return at.toJwt()
}
