import { useEffect, useRef } from "react";

/** Keyboard containment and focus restoration for the app's custom dialogs. */
export function useDialogFocus(open:boolean,onClose:()=>void) {
  const close=useRef(onClose);close.current=onClose;
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    const dialogs=document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog=dialogs[dialogs.length-1];if(!dialog)return;
    const focusable=()=>Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(el=>el.getClientRects().length);
    (focusable()[0]??dialog).focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();close.current();return;}
      if(event.key!=="Tab")return;
      const elements=focusable(),first=elements[0],last=elements.at(-1);
      if(!first){event.preventDefault();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",key);
    return()=>{document.removeEventListener("keydown",key);previous?.focus();};
  },[open]);
}
