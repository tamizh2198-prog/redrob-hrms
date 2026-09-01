import { api } from '@/lib/api'

export interface Holiday {
  id: string
  locationId: string
  year: number
  date: string
  name: string
  isOptional: boolean
}

export function createCalendar(data: {
  locationId: string
  year: number
  holidays: Array<{ date: string; name: string; isOptional?: boolean }>
}) {
  return api<Holiday[]>('/holidays/calendar', { method: 'POST', body: data })
}

export function listCalendar(locationId: string, year: number) {
  return api<Holiday[]>('/holidays/calendar', {
    params: { locationId, year: String(year) },
  })
}

export function selectOptionalHoliday(holidayId: string) {
  return api<{ id: string }>('/holidays/optional/select', {
    method: 'POST',
    body: { holidayId },
  })
}

export function listSelections() {
  return api<Array<{ id: string; holiday: Holiday }>>('/holidays/optional/selections')
}
