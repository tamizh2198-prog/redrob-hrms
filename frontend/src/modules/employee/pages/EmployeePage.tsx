import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import {
  listEmployees,
  listPendingInvitations,
  resendInvitation,
  downloadActiveEmployees,
  computeDisplayCompletionPercentage,
  type Employee,
  type EmployeeStatus,
  type PendingInvitation,
} from '../api'
import { CreateEmployeeDialog } from '../components/CreateEmployeeDialog'
import { BulkImportDialog } from '../components/BulkImportDialog'

const STATUS_OPTIONS: EmployeeStatus[] = [
  'INVITED',
  'ACTIVE',
  'ACTIVE_PROBATION',
  'ON_LEAVE',
  'INACTIVE',
  'TERMINATED',
]

export function EmployeePage() {
  const { user } = useAuth()
  // Bulk-import/create/invitations — general HR access, no approve/reject
  // authority involved, so HR Associate mirrors HR_ADMIN here.
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  // Section 6 Access Control: the backend already scopes /employees down to
  // just this employee's own record for the EMPLOYEE role — these flags only
  // adjust the surrounding chrome (filters/pagination don't mean anything
  // over a single row).
  const isSelfView = user?.role === 'EMPLOYEE'

  // Lets the Dashboard deep-link here with e.g. /employee?status=TERMINATED
  // pre-selected — one-way only (URL -> initial filter), not kept in sync
  // on further changes.
  const [searchParams] = useSearchParams()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<EmployeeStatus | undefined>(
    (searchParams.get('status') as EmployeeStatus | null) ?? undefined,
  )
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [invitationError, setInvitationError] = useState<string | null>(null)
  const [invitationMessage, setInvitationMessage] = useState<string | null>(null)
  const [resendInvitationUrl, setResendInvitationUrl] = useState<string | null>(null)
  const [resendCopied, setResendCopied] = useState(false)
  const [exportingActive, setExportingActive] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  const pageSize = 20

  // Debounced so typing a name/employee code doesn't fire a request per
  // keystroke — 300ms is a common, unobtrusive delay for search-as-you-type.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  useEffect(() => {
    setLoading(true)
    setError(null)
    listEmployees({ status, search: debouncedSearch || undefined, page, pageSize })
      .then((res) => {
        setEmployees(res.items)
        setTotal(res.total)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [status, debouncedSearch, page, refreshKey])

  function refreshInvitations() {
    listPendingInvitations()
      .then(setInvitations)
      .catch(() => setInvitations([]))
  }

  useEffect(() => {
    if (isHrAdmin) refreshInvitations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  async function handleExportActive() {
    setExportError(null)
    setExportingActive(true)
    try {
      await downloadActiveEmployees()
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : 'Failed to download active employees')
    } finally {
      setExportingActive(false)
    }
  }

  async function handleResend(employeeId: string) {
    setInvitationError(null)
    setInvitationMessage(null)
    setResendInvitationUrl(null)
    try {
      const result = await resendInvitation(employeeId)
      setInvitationMessage(
        result.emailSent
          ? 'Reminder email sent successfully.'
          : "Email delivery isn't configured — copy the activation link below and send it to them directly.",
      )
      setResendInvitationUrl(result.invitationUrl ?? null)
      refreshInvitations()
    } catch (err) {
      setInvitationError(err instanceof ApiError ? err.message : 'Failed to resend invitation')
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {isSelfView ? 'My Profile' : 'Employee Directory'}
        </h1>
        <div className="flex gap-2">
          {isHrAdmin && (
            <Link to="/employee/change-requests">
              <Button variant="outline">Change Requests</Button>
            </Link>
          )}
          {isHrAdmin && <BulkImportDialog onImported={refresh} />}
          {isHrAdmin && <CreateEmployeeDialog onCreated={refresh} />}
          {isSuperAdmin && (
            <Button variant="outline" disabled={exportingActive} onClick={handleExportActive}>
              {exportingActive ? 'Downloading…' : 'Download Active Employees'}
            </Button>
          )}
          {isSelfView && user && (
            <Link to={`/employee/${user.id}`}>
              <Button>Add / Update My Details</Button>
            </Link>
          )}
        </div>
      </div>

      {exportError && <p className="text-sm text-destructive">{exportError}</p>}

      {isSelfView && (
        <p className="text-sm text-muted-foreground">
          Contact details, PAN, Aadhaar, bank account, IFSC code, blood group, and emergency
          contact aren't shown in the table below — use "Add / Update My Details" above to add or
          change them.
        </p>
      )}

      {!isSelfView && (
        <div className="flex items-center gap-2">
          {isHrAdmin && (
            <Input
              className="w-64"
              placeholder="Search by name or employee code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
          <Select
            value={status ?? 'ALL'}
            onValueChange={(value) =>
              setStatus(value === 'ALL' ? undefined : (value as EmployeeStatus))
            }
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>PAN</TableHead>
            <TableHead>Profile</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {employees.map((e) => (
            <TableRow key={e.id}>
              <TableCell>{e.employeeCode}</TableCell>
              <TableCell>
                <Link to={`/employee/${e.id}`} className="text-primary underline-offset-4 hover:underline">
                  {e.firstName} {e.lastName}
                </Link>
              </TableCell>
              <TableCell>
                <Badge variant={e.status === 'TERMINATED' ? 'destructive' : 'outline'}>
                  {e.status}
                </Badge>
              </TableCell>
              <TableCell>{e.pan}</TableCell>
              <TableCell className="text-muted-foreground">
                {computeDisplayCompletionPercentage(e)}% Complete
              </TableCell>
            </TableRow>
          ))}
          {!loading && employees.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No employees found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {!isSelfView && (
        <div className="flex items-center justify-between text-sm">
          <span>
            Page {page} of {Math.max(1, Math.ceil(total / pageSize))} ({total} total)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * pageSize >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {isHrAdmin && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Pending Invitations</h2>
          {invitationError && <p className="text-sm text-destructive">{invitationError}</p>}
          {invitationMessage && <p className="text-sm text-primary">{invitationMessage}</p>}
          {resendInvitationUrl && (
            <div className="flex items-center gap-2 rounded-md border bg-muted/50 p-2">
              <Input
                readOnly
                value={resendInvitationUrl}
                className="text-xs"
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(resendInvitationUrl)
                  setResendCopied(true)
                  setTimeout(() => setResendCopied(false), 2000)
                }}
              >
                {resendCopied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Employee Code</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    {inv.employee.firstName} {inv.employee.lastName}
                  </TableCell>
                  <TableCell>{inv.employee.employeeCode}</TableCell>
                  <TableCell>{inv.employee.workEmail}</TableCell>
                  <TableCell>{inv.employee.status}</TableCell>
                  <TableCell>{new Date(inv.expiresAt).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => handleResend(inv.employeeId)}>
                      Remind
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {invitations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No pending invitations.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
