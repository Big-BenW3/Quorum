import type { Metadata } from "next";
import { CreateOrgForm } from "@/components/app/create-org";
import { Card, CardBody } from "@/components/ui/misc";

export const metadata: Metadata = { title: "New organization" };
export default function NewOrg() {
  return (
    <div className="mx-auto max-w-md pt-4">
      <h1 className="text-2xl font-semibold tracking-tight">New organization</h1>
      <Card className="mt-6"><CardBody><CreateOrgForm /></CardBody></Card>
    </div>
  );
}
