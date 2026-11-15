// Zen Staff: "Adaugă un client" from the company switcher (freelancers). The same short form as the
// first run; saving selects the new client, "Spune-mi despre client" opens its interview chat.
import type { EnvironmentId } from "@t3tools/contracts";

import { Dialog, DialogPanel, DialogPopup } from "../../components/ui/dialog";
import { useSelectedCompanyStore } from "../companies/companiesState";
import { useOnboardingDialog } from "../onboarding/onboardingClient";
import { FirstClientForm } from "./FirstClientForm";

export function AddClientDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly onClose: () => void;
}) {
  const setSelected = useSelectedCompanyStore((store) => store.setSelectedCompanyId);
  const openInterview = useOnboardingDialog((store) => store.open);
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogPopup className="sm:max-w-xl" data-zen-add-client-dialog>
        <DialogPanel>
          <FirstClientForm
            environmentId={props.environmentId}
            first={false}
            onSaved={(client) => {
              setSelected(client.id);
              props.onClose();
            }}
            onTellMe={(client) => {
              setSelected(client.id);
              props.onClose();
              openInterview(client.id, "new-company");
            }}
          />
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
