import { api } from '@/lib/api'

export type AssetStatus = 'AVAILABLE' | 'PENDING_HANDOVER' | 'ISSUED' | 'IN_REPAIR' | 'RETIRED'
export type AssetRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED'

export interface Asset {
  id: string
  companyId: string
  category: string
  make: string | null
  model: string | null
  serialNumber: string | null
  purchaseDate: string | null
  cost: number | null
  warrantyExpiry: string | null
  condition: string
  status: AssetStatus
  createdAt: string
}

export interface AssetAssignment {
  id: string
  assetId: string
  employeeId: string
  issuedAt: string
  acknowledgedAt: string | null
  returnedAt: string | null
  returnCondition: string | null
  asset?: Asset
}

export interface AssetRequest {
  id: string
  employeeId: string
  assetCategory: string
  justification: string | null
  status: AssetRequestStatus
  approverId: string | null
  decidedAt: string | null
  createdAt: string
}

export function createAsset(data: {
  companyId?: string
  category: string
  make?: string
  model?: string
  serialNumber?: string
  purchaseDate?: string
  cost?: number
  warrantyExpiry?: string
}) {
  return api<Asset>('/assets', { method: 'POST', body: data })
}

export function listAssets(status?: AssetStatus) {
  return api<Asset[]>('/assets', { params: { status } })
}

export function listMyAssets() {
  return api<AssetAssignment[]>('/assets/mine')
}

export function createAssetRequest(data: { assetCategory: string; justification?: string }) {
  return api<AssetRequest>('/assets/requests', { method: 'POST', body: data })
}

export function listAssetRequests(params: { employeeId?: string; approverId?: string } = {}) {
  return api<AssetRequest[]>('/assets/requests', { params })
}

export function decideAssetRequest(id: string, approve: boolean) {
  return api<AssetRequest>(`/assets/requests/${id}/decision`, { method: 'POST', body: { approve } })
}

export function issueAsset(assetId: string, employeeId: string) {
  return api<AssetAssignment>(`/assets/${assetId}/issue`, { method: 'POST', body: { employeeId } })
}

export function acknowledgeAsset(assignmentId: string) {
  return api<AssetAssignment>(`/assets/assignments/${assignmentId}/acknowledge`, { method: 'POST' })
}

export function returnAsset(assetId: string, data: { condition?: 'GOOD' | 'DAMAGED'; remarks?: string } = {}) {
  return api<AssetAssignment>(`/assets/${assetId}/return`, { method: 'POST', body: data })
}
