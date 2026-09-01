import { ChangeRequestsPage } from "@/modules/employee/pages/ChangeRequestsPage"
import { RequireRole } from "@/shared/routes/RequireRole"

export default function Page() {
  return (
    <RequireRole roles={["HR_ADMIN", "SUPER_ADMIN"]}>
      <ChangeRequestsPage />
    </RequireRole>
  )
}
