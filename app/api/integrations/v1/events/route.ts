import {authenticateIntegration,applyIntegrationEvent} from "@/lib/integrations";
import {boundedJson,integrationJson,integrationFailure} from "@/lib/integration-http";
import {integrationEventSchema,IntegrationError} from "@/lib/integration-contract";
export const dynamic="force-dynamic";
export async function POST(request:Request){try{const actor=await authenticateIntegration(request);const parsed=integrationEventSchema.safeParse(await boundedJson(request));if(!parsed.success)throw new IntegrationError(400,"invalid_event",parsed.error.issues.map(issue=>issue.path.join(".")+": "+issue.message).join("; "));return integrationJson(await applyIntegrationEvent(actor,parsed.data));}catch(error){return integrationFailure(error)}}
