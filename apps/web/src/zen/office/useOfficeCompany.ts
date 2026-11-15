// Zen Staff: the company the Office pages work for, from the sidebar's company switcher.
import { useCompanyIndex, useActiveCompanyId } from "../companies/companiesState";
import { workflowsInput } from "./officeState";

export function useOfficeCompany() {
  const index = useCompanyIndex();
  const companyId = useActiveCompanyId(index);
  return { index, companyId, workflowsInput: workflowsInput(companyId) };
}
