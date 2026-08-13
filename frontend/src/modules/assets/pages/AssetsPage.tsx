import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { getReferenceData, type ManagerOption } from '@/modules/employee/api'
import {
  createAsset,
  listAssets,
  listMyAssets,
  createAssetRequest,
  listAssetRequests,
  decideAssetRequest,
  issueAsset,
  acknowledgeAsset,
  returnAsset,
  type Asset,
  type AssetAssignment,
  type AssetRequest,
} from '../api'

export function AssetsPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [people, setPeople] = useState<ManagerOption[]>([])
  const [myAssignments, setMyAssignments] = useState<AssetAssignment[]>([])
  const [myRequests, setMyRequests] = useState<AssetRequest[]>([])
  const [decidableRequests, setDecidableRequests] = useState<AssetRequest[]>([])
  const [assets, setAssets] = useState<Asset[]>([])

  const [requestCategory, setRequestCategory] = useState('')
  const [requestJustification, setRequestJustification] = useState('')

  const [assetCategory, setAssetCategory] = useState('')
  const [assetMake, setAssetMake] = useState('')
  const [assetModel, setAssetModel] = useState('')
  const [assetSerial, setAssetSerial] = useState('')
  const [assetCost, setAssetCost] = useState('')

  const [issueAssetId, setIssueAssetId] = useState('')
  const [issueEmployeeId, setIssueEmployeeId] = useState('')

  const [returnAssetId, setReturnAssetId] = useState('')
  const [returnCondition, setReturnCondition] = useState<'GOOD' | 'DAMAGED'>('GOOD')
  const [returnRemarks, setReturnRemarks] = useState('')

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getReferenceData().then((r) => setPeople(r.managers))
    refreshMine()
    if (isHrAdmin) {
      refreshAllAssets()
      refreshDecidable()
    }
  }, [])

  function refreshMine() {
    listMyAssets().then(setMyAssignments).catch(() => setMyAssignments([]))
    if (user) listAssetRequests({ employeeId: user.id }).then(setMyRequests).catch(() => setMyRequests([]))
  }

  // Asset request approval is HR Admin/Super Admin only — a Manager never
  // has requests to decide here, regardless of their reporting line.
  function refreshDecidable() {
    listAssetRequests().then(setDecidableRequests).catch(() => setDecidableRequests([]))
  }

  function refreshAllAssets() {
    listAssets().then(setAssets).catch(() => setAssets([]))
  }

  function personName(id: string) {
    const p = people.find((m) => m.id === id)
    return p ? `${p.firstName} ${p.lastName}` : id
  }

  async function handleCreateRequest() {
    setError(null)
    setMessage(null)
    try {
      await createAssetRequest({ assetCategory: requestCategory, justification: requestJustification || undefined })
      setMessage('Asset request raised.')
      setRequestCategory('')
      setRequestJustification('')
      refreshMine()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to raise asset request')
    }
  }

  async function handleDecide(id: string, approve: boolean) {
    setError(null)
    try {
      await decideAssetRequest(id, approve)
      refreshDecidable()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record decision')
    }
  }

  async function handleCreateAsset() {
    setError(null)
    setMessage(null)
    try {
      await createAsset({
        category: assetCategory,
        make: assetMake || undefined,
        model: assetModel || undefined,
        serialNumber: assetSerial || undefined,
        cost: assetCost ? Number(assetCost) : undefined,
      })
      setMessage('Asset registered.')
      setAssetCategory('')
      setAssetMake('')
      setAssetModel('')
      setAssetSerial('')
      setAssetCost('')
      refreshAllAssets()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to register asset')
    }
  }

  async function handleIssue() {
    if (!issueAssetId || !issueEmployeeId) return
    setError(null)
    setMessage(null)
    try {
      await issueAsset(issueAssetId, issueEmployeeId)
      setMessage('Asset issued — pending the employee acknowledgement.')
      refreshAllAssets()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to issue asset')
    }
  }

  async function handleAcknowledge(assignmentId: string) {
    setError(null)
    try {
      await acknowledgeAsset(assignmentId)
      refreshMine()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to acknowledge asset')
    }
  }

  async function handleReturn() {
    if (!returnAssetId) return
    setError(null)
    setMessage(null)
    try {
      await returnAsset(returnAssetId, { condition: returnCondition, remarks: returnRemarks || undefined })
      setMessage('Asset marked as returned.')
      setReturnAssetId('')
      setReturnRemarks('')
      refreshAllAssets()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record asset return')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Asset Management</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">My Assets</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {myAssignments.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded border p-2">
                  <div>
                    <p className="font-medium">
                      {a.asset?.category} {a.asset?.make} {a.asset?.model}
                    </p>
                    <p className="text-muted-foreground">Serial: {a.asset?.serialNumber ?? '—'}</p>
                  </div>
                  {!a.acknowledgedAt && !a.returnedAt && (
                    <Button size="sm" variant="outline" onClick={() => handleAcknowledge(a.id)}>
                      Acknowledge
                    </Button>
                  )}
                  {a.acknowledgedAt && !a.returnedAt && <Badge variant="default">Issued</Badge>}
                  {a.returnedAt && <Badge variant="outline">Returned</Badge>}
                </li>
              ))}
              {myAssignments.length === 0 && <p className="text-muted-foreground">No assets assigned to you.</p>}
            </ul>
          </div>

          <div className="rounded-md border p-4">
            <h2 className="mb-2 font-medium">Request an Asset</h2>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                placeholder="Category (e.g. Laptop)"
                value={requestCategory}
                onChange={(e) => setRequestCategory(e.target.value)}
              />
              <Input
                placeholder="Justification"
                value={requestJustification}
                onChange={(e) => setRequestJustification(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={handleCreateRequest}>
                Raise Request
              </Button>
            </div>

            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {myRequests.map((r) => (
                <li key={r.id} className="flex items-center justify-between rounded border p-2">
                  <span>{r.assetCategory}</span>
                  <Badge variant="outline">{r.status}</Badge>
                </li>
              ))}
              {myRequests.length === 0 && <p className="text-muted-foreground">No requests raised yet.</p>}
            </ul>
          </div>

          {isHrAdmin && (
            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">Requests To Decide</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {decidableRequests
                  .filter((r) => r.status === 'PENDING')
                  .map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded border p-2">
                      <span>
                        {personName(r.employeeId)} — {r.assetCategory}
                      </span>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleDecide(r.id, true)}>
                          Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDecide(r.id, false)}>
                          Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                {decidableRequests.filter((r) => r.status === 'PENDING').length === 0 && (
                  <p className="text-muted-foreground">Nothing pending your decision.</p>
                )}
              </ul>
            </div>
          )}
        </div>

        {isHrAdmin && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">Register Asset</h2>
              <div className="flex flex-col gap-2">
                <Input placeholder="Category" value={assetCategory} onChange={(e) => setAssetCategory(e.target.value)} />
                <Input placeholder="Make" value={assetMake} onChange={(e) => setAssetMake(e.target.value)} />
                <Input placeholder="Model" value={assetModel} onChange={(e) => setAssetModel(e.target.value)} />
                <Input placeholder="Serial Number" value={assetSerial} onChange={(e) => setAssetSerial(e.target.value)} />
                <Input
                  placeholder="Cost"
                  type="number"
                  value={assetCost}
                  onChange={(e) => setAssetCost(e.target.value)}
                />
                <Button variant="outline" onClick={handleCreateAsset}>
                  Register
                </Button>
              </div>
            </div>

            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">All Assets</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {assets.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded border p-2">
                    <span>
                      {a.category} {a.make} {a.model} ({a.serialNumber ?? 'no serial'})
                    </span>
                    <Badge variant="outline">{a.status}</Badge>
                  </li>
                ))}
                {assets.length === 0 && <p className="text-muted-foreground">No assets registered yet.</p>}
              </ul>
            </div>

            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">Issue Asset</h2>
              <div className="flex flex-col gap-2">
                <Label>Asset</Label>
                <Select value={issueAssetId} onValueChange={setIssueAssetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select asset">
                      {(v: string) => {
                        const a = assets.find((x) => x.id === v)
                        return a ? `${a.category} (${a.serialNumber ?? 'no serial'})` : 'Select'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.category} ({a.serialNumber ?? 'no serial'}) — {a.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label>Employee</Label>
                <Select value={issueEmployeeId} onValueChange={setIssueEmployeeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select employee">{(v: string) => personName(v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.firstName} {p.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={handleIssue}>
                  Issue
                </Button>
              </div>
            </div>

            <div className="rounded-md border p-4">
              <h2 className="mb-2 font-medium">Process Return</h2>
              <div className="flex flex-col gap-2">
                <Label>Asset</Label>
                <Select value={returnAssetId} onValueChange={setReturnAssetId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select asset">
                      {(v: string) => {
                        const a = assets.find((x) => x.id === v)
                        return a ? `${a.category} (${a.serialNumber ?? 'no serial'})` : 'Select'
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {assets
                      .filter((a) => a.status === 'ISSUED' || a.status === 'PENDING_HANDOVER')
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.category} ({a.serialNumber ?? 'no serial'})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Label>Condition</Label>
                <Select value={returnCondition} onValueChange={(v) => setReturnCondition(v as 'GOOD' | 'DAMAGED')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Condition">{(v: string) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GOOD">GOOD</SelectItem>
                    <SelectItem value="DAMAGED">DAMAGED</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea
                  placeholder="Remarks"
                  value={returnRemarks}
                  onChange={(e) => setReturnRemarks(e.target.value)}
                />
                <Button variant="outline" onClick={handleReturn}>
                  Record Return
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
