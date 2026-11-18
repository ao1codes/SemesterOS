import { useState } from "react";
import { useDeleteAccount } from "@workspace/api-client-react";
import { useClerk } from "@/lib/account-auth";

export function AccountDeletion({disabled=false}:{disabled?:boolean}) {
  const mutation=useDeleteAccount();
  const {signOut}=useClerk();
  const [confirmation,setConfirmation]=useState("");
  return <div style={{marginTop:22}}>
    <h3>Delete your account</h3>
    <p className="card-caption">Permanently removes your sign-in identity, semester, calendar tokens, and queued reminders. External calendar events are not deleted. This cannot be undone. If the identity service fails after data removal, retry to finish closing the account.</p>
    <label htmlFor="delete-account-confirmation">Type DELETE to confirm</label>
    <input id="delete-account-confirmation" className="field" value={confirmation} onChange={e=>setConfirmation(e.target.value)} autoComplete="off"/>
    <button className="quiet-button" style={{marginTop:10,color:"#a44940"}} disabled={disabled||confirmation!=="DELETE"||mutation.isPending} onClick={()=>{
      if(!window.confirm("Delete your account and all SemesterOS data permanently? Existing external calendar events will remain."))return;
      mutation.mutate(undefined,{onSuccess:()=>void signOut({redirectUrl:import.meta.env.BASE_URL})});
    }}>{mutation.isPending?"Closing account…":"Permanently delete my account"}</button>
    {mutation.isError&&<p role="alert">Account deletion did not finish. Your semester may already have been removed; retry to finish closing the sign-in account.</p>}
  </div>;
}
