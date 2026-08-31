import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/shared/auth/AuthContext'
import { ApiError } from '@/lib/api'
import { getReferenceData, type ReferenceOption } from '@/modules/employee/api'
import {
  createCalendar,
  listCalendar,
  selectOptionalHoliday,
  listSelections,
  type Holiday,
} from '../api'

const now = new Date()

export function HolidayPage() {
  const { user } = useAuth()
  const isHrAdmin = user?.role === 'HR_ADMIN' || user?.role === 'SUPER_ADMIN' || user?.role === 'HR_ASSOCIATE'

  const [locations, setLocations] = useState<ReferenceOption[]>([])
  const [locationId, setLocationId] = useState('')
  const [year, setYear] = useState(now.getFullYear())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const [newDate, setNewDate] = useState('')
  const [newName, setNewName] = useState('')
  const [newIsOptional, setNewIsOptional] = useState(false)

  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getReferenceData().then((r) => {
      setLocations(r.locations)
      if (r.locations[0]) setLocationId(r.locations[0].id)
    })
  }, [])

  function refresh() {
    if (!locationId) return
    listCalendar(locationId, year).then(setHolidays).catch(() => setHolidays([]))
    listSelections()
      .then((sels) => setSelectedIds(new Set(sels.map((s) => s.holiday.id))))
      .catch(() => setSelectedIds(new Set()))
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationId, year])

  async function handlePublish() {
    setError(null)
    setMessage(null)
    try {
      await createCalendar({
        locationId,
        year,
        holidays: [{ date: newDate, name: newName, isOptional: newIsOptional }],
      })
      setMessage('Holiday published.')
      setNewDate('')
      setNewName('')
      refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to publish holiday')
    }
  }

  async function handleSelect(holidayId: string) {
    setError(null)
    try {
      await selectOptionalHoliday(holidayId)
      setSelectedIds((s) => new Set(s).add(holidayId))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to select holiday')
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Holiday Calendar</h1>

      {message && <p className="text-sm text-primary">{message}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label>Location</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select location">
                {(value: string) =>
                  locations.find((l) => l.id === value)?.name ?? 'Select location'
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label>Year</Label>
          <Input
            type="number"
            className="w-24"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Calendar</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {holidays.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3">
                <span className="min-w-24 shrink-0 text-muted-foreground">{h.date.slice(0, 10)}</span>
                <span className="min-w-0 flex-1 truncate">{h.name}</span>
                {h.isOptional && <Badge variant="outline">Optional</Badge>}
                {h.isOptional && !selectedIds.has(h.id) && (
                  <Button size="sm" variant="outline" onClick={() => handleSelect(h.id)}>
                    Select
                  </Button>
                )}
                {h.isOptional && selectedIds.has(h.id) && (
                  <Badge>Selected</Badge>
                )}
              </li>
            ))}
            {holidays.length === 0 && (
              <p className="text-muted-foreground">No holidays published for this calendar yet.</p>
            )}
          </ul>
        </CardContent>
      </Card>

      {isHrAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Publish Holiday (HR Admin)</CardTitle>
          </CardHeader>
          <CardContent>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label>Date</Label>
              <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsOptional}
                onChange={(e) => setNewIsOptional(e.target.checked)}
              />
              Optional
            </label>
            <Button variant="outline" onClick={handlePublish}>
              Publish
            </Button>
          </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
