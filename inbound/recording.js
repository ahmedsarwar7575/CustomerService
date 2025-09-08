import twilio from "twilio";
import dotenv from "dotenv";

dotenv.config();
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken  = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const CALL_SID = "CA95387ae0247e65f5b9678ce71788fddc";

export async function debug() {
  // Fetch the call to confirm account + status
  const call = await client.calls(CALL_SID).fetch();
  console.log({
    callSid: call.sid,
    accountSid: call.accountSid,
    status: call.status,
    parentCallSid: call.parentCallSid,
    to: call.to,
    from: call.from
  });

  // 1) Look for recordings directly on the parent call
  const onParent = await client.recordings.list({ callSid: CALL_SID, limit: 20 });
  console.log("Recordings on parent:", onParent.map(r => r.sid));

  // 2) Some flows create CHILD call legs (e.g., <Dial/>). Check those too.
  const children = await client.calls.list({ parentCallSid: CALL_SID, limit: 20 });
  console.log("Child calls:", children.map(c => c.sid));

  for (const child of children) {
    const onChild = await client.recordings.list({ callSid: child.sid, limit: 20 });
    console.log(`Recordings on ${child.sid}:`, onChild.map(r => r.sid));
  }
}

debug().catch(console.error);
