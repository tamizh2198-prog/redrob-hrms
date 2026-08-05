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
import { listEmployees, type Employee, type EmployeeStatus } from '../api'
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

  const [employees, setEmployees] = useState<Employee[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<EmployeeStatus | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const pageSize = 20

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

  function refresh() {
    setRefreshKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Employee Directory</h1>
        <div className="flex gap-2">
          {isHrAdmin && (
            <Link to="/employee/change-requests">
              <Button variant="outline">Change Requests</Button>
            </Link>
          )}
          {isHrAdmin && <BulkImportDialog onImported={refresh} />}
          {isHrAdmin && <CreateEmployeeDialog onCreated={refresh} />}
        </div>
      </div>

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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>PAN</TableHead>
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
              <TableCell>{e.status}</TableCell>
              <TableCell>{e.pan}</TableCell>
            </TableRow>
          ))}
          {!loading && employees.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                No employees found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

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
    </div>
  )
}
