import { AppShell } from "@/components/app-shell";
import { InitializeProjectFlow } from "@/components/initialize-project-flow";

export default function NewProjectPage() {
  return (
    <AppShell>
      <div className="relative z-10 p-6 md:p-10 max-w-4xl mx-auto">
        <InitializeProjectFlow />
      </div>
    </AppShell>
  );
}
