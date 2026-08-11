import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
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
import { useAuth } from '@/shared/auth/AuthContext'
import {
  getReferenceData,
  listEmployees,
  type Employee,
  type EmployeeStatus,
  type ReferenceData,
} from '../api'
import { CreateEmployeeDialog } from '../components/CreateEmployeeDialog'
import { BulkImportDialog } from '../components/BulkImportDialog'

const STATUS_OPTIONS: EmployeeStatus[] = [
  'ACTIVE',
  'ACTIVE_PROBATION',
  'ON_LEAVE',
  'INACTIVE',
  'TERMINATED',
]

export function EmployeePage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN'
  // Section 6 Access Control: the backend already scopes /employees down to
  // just this employee's own record for the EMPLOYEE role — these flags only
  // adjust the surrounding chrome (filters/pagination don't mean anything
  // over a single row).
  const isSelfView = user?.role === 'EMPLOYEE'

  const [employees, setEmployees] = useState<Employee[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<EmployeeStatus | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [reference, setReference] = useState<ReferenceData | null>(null)

  const pageSize = 20

  useEffect(() => {
    getReferenceData().then(setReference).catch(() => setReference(null))
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    listEmployees({ status, page, pageSize })
      .then((res) => {
        setEmployees(res.items)
        setTotal(res.total)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [status, page, refreshKey])

  function designationName(id: string | null) {
    return reference?.designations.find((d) => d.id === id)?.name ?? '—'
  }

  function locationName(id: string | null) {
    return reference?.locations.find((l) => l.id === id)?.name ?? '—'
  }

  function refresh() {
    setRefreshKey((k) => k + 1)
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
          {isSelfView && user && (
            <Link to={`/employee/${user.id}`}>
              <Button>Add / Update My Details</Button>
            </Link>
          )}
        </div>
      </div>

      {isSelfView && (
        <p className="text-sm text-muted-foreground">
          Contact details, PAN, Aadhaar, bank account, IFSC code, blood group, and emergency
          contact aren't shown in the table below — use "Add / Update My Details" above to add or
          change them.
        </p>
      )}

      {!isSelfView && (
        <div className="flex items-center gap-2">
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
            <TableHead>Designation</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Status</TableHead>
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
              <TableCell>{designationName(e.designationId)}</TableCell>
              <TableCell>{locationName(e.locationId)}</TableCell>
              <TableCell>{e.status}</TableCell>
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
    </div>
  )
}
