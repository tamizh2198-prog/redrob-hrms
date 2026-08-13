import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/shared/auth/AuthContext'
import { useTheme } from '@/shared/theme/ThemeContext'
import { ApiError } from '@/lib/api'
import {
  getCompanySettings,
  updateCompanySettings,
  listOrgStructure,
  createOrgUnit,
  updateOrgUnit,
  listIntegrations,
  updateIntegration,
  type CompanySettings,
  type OrgStructure,
  type OrgUnit,
  type OrgUnitType,
  type IntegrationConfig,
  type IntegrationType,
} from '../api'

const ORG_UNIT_TYPES: OrgUnitType[] = ['department', 'location', 'designation', 'grade']

function label(value: string) {
  return value.replaceAll('_', ' ')
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' {
  if (status === 'CONFIGURED') return 'default'
  if (status === 'ERROR') return 'destructive'
  return 'secondary'
}

export function SettingsPage() {
  const { user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  // Matches the backend's own @Roles(HR_ADMIN, SUPER_ADMIN) gate on every
  // GET here — a Manager/Employee calling these would just get 403s, so
  // skip the fetch (and the cards below) entirely instead of showing sections
  // stuck on "Loading…" for a role that can never see them.
  const canViewCompanySettings = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'

  const [company, setCompany] = useState<CompanySettings | null>(null)
  const [logoUrl, setLogoUrl] = useState('')
  const [primaryColor, setPrimaryColor] = useState('')
  const [timezone, setTimezone] = useState('')
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState('')

  const [orgStructure, setOrgStructure] = useState<OrgStructure | null>(null)
  const [unitType, setUnitType] = useState<OrgUnitType>('department')
  const [unitName, setUnitName] = useState('')
  const [unitCode, setUnitCode] = useState('')
  const [unitParentId, setUnitParentId] = useState('')
  const [forcePending, setForcePending] = useState<{ type: OrgUnitType; id: string } | null>(null)

  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([])

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canViewCompanySettings) return
    refreshCompany()
    refreshOrgStructure()
    refreshIntegrations()
  }, [canViewCompanySettings])

  function refreshCompany() {
    getCompanySettings()
      .then((c) => {
        setCompany(c)
        setLogoUrl(c.logoUrl ?? '')
        setPrimaryColor(c.primaryColor ?? '')
        setTimezone(c.timezone)
        setFiscalYearStartMonth(String(c.fiscalYearStartMonth))
      })
      .catch(() => setCompany(null))
  }

  function refreshOrgStructure() {
    listOrgStructure().then(setOrgStructure).catch(() => setOrgStructure(null))
  }

  function refreshIntegrations() {
    listIntegrations().then(setIntegrations).catch(() => setIntegrations([]))
  }

  async function handleUpdateCompany() {
    setError(null)
    setMessage(null)
    try {
      await updateCompanySettings({
        logoUrl: logoUrl || undefined,
        primaryColor: primaryColor || undefined,
        timezone: timezone || undefined,
        fiscalYearStartMonth: fiscalYearStartMonth ? Number(fiscalYearStartMonth) : undefined,
      })
      setMessage('Company settings saved.')
      refreshCompany()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save company settings')
    }
  }

  async function handleCreateUnit() {
    if (!unitName || !unitCode) {
      setError('Name and code are required')
      return
    }
    setError(null)
    setMessage(null)
    try {
      await createOrgUnit(unitType, {
        name: unitName,
        code: unitCode,
        parentId: unitType === 'department' ? unitParentId || undefined : undefined,
      })
      setMessage(`${label(unitType)} created.`)
      setUnitName('')
      setUnitCode('')
      setUnitParentId('')
      refreshOrgStructure()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to create ${unitType}`)
    }
  }

  async function handleToggleActive(type: OrgUnitType, unit: OrgUnit, force = false) {
    setError(null)
    setMessage(null)
    try {
      await updateOrgUnit(type, unit.id, { isActive: !unit.isActive, force })
      setMessage(`${label(type)} ${unit.isActive ? 'deactivated' : 'reactivated'}.`)
      setForcePending(null)
      refreshOrgStructure()
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('force')) {
        setError(`${err.message} Use "Force deactivate" to confirm.`)
        setForcePending({ type, id: unit.id })
      } else {
        setError(err instanceof ApiError ? err.message : `Failed to update ${type}`)
      }
    }
  }

  async function handleUpdateIntegration(
    type: IntegrationType,
    status: IntegrationConfig['status'],
    note: string,
  ) {
    setError(null)
    setMessage(null)
    try {
      await updateIntegration(type, {
        status,
        metadata: note ? { note } : undefined,
      })
      setMessage(`${label(type)} integration updated.`)
      refreshIntegrations()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to update ${type}`)
    }
  }

  const unitsByType: Record<OrgUnitType, OrgUnit[]> = {
    department: orgStructure?.departments ?? [],
    location: orgStructure?.locations ?? [],
    designation: orgStructure?.designations ?? [],
    grade: orgStructure?.grades ?? [],
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Settings</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Personal preference, not a company setting — visible to every
          role, unlike the admin-only cards below. */}
      <div className="rounded-md border p-4 text-sm">
        <h2 className="mb-2 font-medium">Preferences</h2>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Appearance</p>
            <p className="text-muted-foreground">Switch between light and dark mode.</p>
          </div>
          <Button size="sm" variant="outline" onClick={toggleTheme}>
            {theme === 'dark' ? (
              <>
                <Moon className="size-4" /> Dark mode
              </>
            ) : (
              <>
                <Sun className="size-4" /> Light mode
              </>
            )}
          </Button>
        </div>
      </div>

      {!canViewCompanySettings && (
        <p className="text-sm text-muted-foreground">
          Company profile, org structure, and integrations are managed by HR Admin/Super Admin.
        </p>
      )}

      {canViewCompanySettings && (
        <>
      <div className="rounded-md border p-4 text-sm">
        <h2 className="mb-2 font-medium">Company Profile</h2>
        {company ? (
          isSuperAdmin ? (
            <div className="flex flex-col gap-2 lg:max-w-md">
              <Label>Logo URL</Label>
              <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              <Label>Primary Color</Label>
              <Input
                value={primaryColor}
                placeholder="#000000"
                onChange={(e) => setPrimaryColor(e.target.value)}
              />
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              <Label>Fiscal Year Start Month (1-12)</Label>
              <Input
                type="number"
                min={1}
                max={12}
                value={fiscalYearStartMonth}
                onChange={(e) => setFiscalYearStartMonth(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={handleUpdateCompany}>
                Save
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p>Timezone: {company.timezone}</p>
              <p>Fiscal year starts: month {company.fiscalYearStartMonth}</p>
              <p className="text-muted-foreground">
                Only a Super Admin can edit company profile settings.
              </p>
            </div>
          )
        ) : (
          <p className="text-muted-foreground">Loading…</p>
        )}
      </div>

      <div className="rounded-md border p-4 text-sm">
        <h2 className="mb-2 font-medium">Org Structure</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ORG_UNIT_TYPES.map((type) => (
            <div key={type}>
              <h3 className="mb-1 font-medium">{label(type)}s</h3>
              <ul className="flex flex-col gap-1">
                {unitsByType[type].map((unit) => (
                  <li
                    key={unit.id}
                    className="flex items-center justify-between rounded border p-2"
                  >
                    <span>
                      {unit.name} ({unit.code})
                    </span>
                    <div className="flex items-center gap-2">
                      {!unit.isActive && <Badge variant="secondary">Inactive</Badge>}
                      {isSuperAdmin && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleToggleActive(type, unit)}
                          >
                            {unit.isActive ? 'Deactivate' : 'Reactivate'}
                          </Button>
                          {forcePending?.type === type && forcePending.id === unit.id && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleToggleActive(type, unit, true)}
                            >
                              Force deactivate
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                ))}
                {unitsByType[type].length === 0 && (
                  <p className="text-muted-foreground">None yet.</p>
                )}
              </ul>
            </div>
          ))}
        </div>

        {isSuperAdmin && (
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
            <Select value={unitType} onValueChange={(v) => setUnitType(v as OrgUnitType)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Type">{(v: string) => label(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ORG_UNIT_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {label(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input placeholder="Name" value={unitName} onChange={(e) => setUnitName(e.target.value)} />
            <Input placeholder="Code" value={unitCode} onChange={(e) => setUnitCode(e.target.value)} />
            {unitType === 'department' && (
              <Select value={unitParentId} onValueChange={setUnitParentId}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Parent department (optional)">
                    {(v: string) => unitsByType.department.find((d) => d.id === v)?.name ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {unitsByType.department.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="outline" onClick={handleCreateUnit}>
              Add {label(unitType)}
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-md border p-4 text-sm">
        <h2 className="mb-2 font-medium">Integrations</h2>
        <p className="mb-3 text-muted-foreground">
          This build has no OAuth/SMTP/SMS SDK wired up — status and a non-secret note are tracked
          here, never real credentials.
        </p>
        <ul className="flex flex-col gap-2">
          {integrations.map((integration) => (
            <IntegrationRow
              key={integration.type}
              integration={integration}
              canEdit={isSuperAdmin}
              onSave={handleUpdateIntegration}
            />
          ))}
          {integrations.length === 0 && <p className="text-muted-foreground">Loading…</p>}
        </ul>
      </div>
        </>
      )}
    </div>
  )
}

function IntegrationRow({
  integration,
  canEdit,
  onSave,
}: {
  integration: IntegrationConfig
  canEdit: boolean
  onSave: (
    type: IntegrationType,
    status: IntegrationConfig['status'],
    note: string,
  ) => void
}) {
  const [status, setStatus] = useState(integration.status)
  const [note, setNote] = useState((integration.metadata?.note as string) ?? '')

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border p-2">
      <div className="flex items-center gap-2">
        <span className="font-medium">{label(integration.type)}</span>
        <Badge variant={statusVariant(integration.status)}>{label(integration.status)}</Badge>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as IntegrationConfig['status'])}>
            <SelectTrigger className="w-40">
              <SelectValue>{(v: string) => label(v)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NOT_CONFIGURED">Not Configured</SelectItem>
              <SelectItem value="CONFIGURED">Configured</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
            </SelectContent>
          </Select>
          <Input
            className="w-56"
            placeholder="Note (e.g. webhook URL, tenant domain)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={() => onSave(integration.type, status, note)}>
            Save
          </Button>
        </div>
      )}
    </li>
  )
}
