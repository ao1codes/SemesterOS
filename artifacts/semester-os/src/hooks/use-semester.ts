import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/account-auth";
import {
  setAuthTokenGetter,
  useGetSemesterState,
  useSaveSemesterState,
  useDeleteSemesterState,
  getGetSemesterStateQueryKey,
} from "@workspace/api-client-react";
import type { SemesterState } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { seedState } from "@/data/demo-semester";
import { normalizeClockTime } from "@workspace/academic";

export const DEMO_STORAGE_KEY = "semester-os-demo-spring-2027-v1";
const emptyAccountState: SemesterState = {
  courses:[],assignments:[],sessions:[],notifications:[],documents:[],
  preferences:{timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"America/New_York",semesterStart:"",semesterEnd:"",availableDays:[1,2,3,4,5],availabilityStart:"09:00",availabilityEnd:"20:00",preferredTime:"afternoon",sessionDurationMinutes:45,breakMinutes:10,dailyStudyLimit:3,reminderHours:[24,2],notificationCategories:["deadline","exam","study_session","workload","conflict","missed_session","syllabus","progress"],quietHoursStart:"22:00",quietHoursEnd:"08:00"},
};
function readDemo(): SemesterState {
  try {
    const saved = localStorage.getItem(DEMO_STORAGE_KEY);
    return saved ? { ...seedState, ...JSON.parse(saved) } : seedState;
  } catch { return seedState; }
}

export function useSemester() {
  const { isSignedIn, isLoaded, userId, getToken } = useAuth();
  const queryClient = useQueryClient();
  const key = [...getGetSemesterStateQueryKey(),userId??"demo"];
  const draft = useRef<SemesterState|null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const dirty = useRef(false);
  const revision = useRef<string|undefined>(undefined);
  const [saveError,setSaveError] = useState(false);
  const [saveErrorMessage,setSaveErrorMessage] = useState("");
  const [conflict,setConflict] = useState(false);
  const [saving,setSaving] = useState(false);
  const [authTokenReady,setAuthTokenReady] = useState(false);
  useEffect(()=>{
    if(!isLoaded){setAuthTokenReady(false);return;}
    if(!isSignedIn){
      setAuthTokenGetter(null);
      setAuthTokenReady(true);
      return;
    }
    setAuthTokenGetter(()=>getToken());
    setAuthTokenReady(true);
    return ()=>setAuthTokenGetter(null);
  },[getToken,isLoaded,isSignedIn]);
  const query = useGetSemesterState({
    query: { enabled: Boolean(isLoaded && isSignedIn && authTokenReady && !saving && !saveError), queryKey: key, retry: false, refetchInterval:30000, staleTime:10000 },
  });
  const saveMutation = useSaveSemesterState();
  const deleteMutation = useDeleteSemesterState();
  const [demo, setDemo] = useState<SemesterState>(() => readDemo());
  const [serverState, setServerState] = useState<SemesterState | null>(null);
  useEffect(() => {
    if (query.data && !busy.current && !dirty.current) {
      draft.current=query.data;revision.current=query.data.revision;setServerState(query.data);
    }
  }, [query.data]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const warn=(e:BeforeUnloadEvent)=>{if(dirty.current){e.preventDefault();e.returnValue="";}};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[]);
  useEffect(() => {
    if (!isSignedIn) {
      setServerState(null);
      try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(demo)); } catch { /* Storage can be disabled by the browser. */ }
    }
  }, [demo, isSignedIn]);

  const currentState = isSignedIn ? serverState ?? emptyAccountState : demo;
  const mode = isSignedIn ? "account" : "demo";
  const flush = async () => {
    if(busy.current || !draft.current || !dirty.current) return;
    busy.current=true;setSaving(true);setSaveError(false);setSaveErrorMessage("");
    while(dirty.current && alive.current) {
      const submitted=draft.current!;
      dirty.current=false;
      try {
        const normalizedSubmitted={
          ...submitted,
          assignments:submitted.assignments.map(assignment=>({...assignment,dueTime:normalizeClockTime(assignment.dueTime)})),
        };
        const saved=await saveMutation.mutateAsync({data:{...normalizedSubmitted,revision:revision.current}});
        if(!alive.current) break;
        revision.current=saved.revision;
        if(!dirty.current){draft.current=saved;setServerState(saved);queryClient.setQueryData(key,saved);}
      } catch(error) {
        if(alive.current){
          dirty.current=true;setSaveError(true);setConflict((error as {status?:number}).status===409);
          const serverError=(error as {data?:{error?:unknown}})?.data?.error;
          setSaveErrorMessage(typeof serverError==="string"?serverError:error instanceof Error?error.message:"The server could not save this change.");
        }
        break;
      }
    }
    busy.current=false;if(alive.current)setSaving(false);
  };
  const update = (recipe: (current: SemesterState) => SemesterState) => {
    if(isSignedIn&&(!draft.current||saveError||query.isError||deleteMutation.isPending))return;
    if (isSignedIn) {
      const next=recipe(draft.current!);
      draft.current=next;dirty.current=true;
      setServerState(next);
      void flush();
    } else setDemo(current=>recipe(current));
  };
  const reloadSaved = async () => {
    if(dirty.current&&!window.confirm("Discard unsaved local changes and load the latest saved semester?"))return;
    dirty.current=false;setSaveError(false);setSaveErrorMessage("");setConflict(false);
    const result=await query.refetch();
    if(result.data){draft.current=result.data;revision.current=result.data.revision;setServerState(result.data);}
  };
  const deleteAccountData = () => { if(busy.current)return;deleteMutation.mutate(undefined, {
    onSuccess: () => {
      dirty.current=false;draft.current=null;
      setServerState(null);
      queryClient.invalidateQueries({ queryKey:key });
    },
  });};
  const byCourse = useMemo(() => Object.fromEntries(currentState.courses.map(c => [c.id,c])), [currentState.courses]);
  return { state:currentState, update, mode, isSignedIn: Boolean(isSignedIn), isLoaded, isLoading: Boolean(isSignedIn && query.isLoading), loadError:Boolean(isSignedIn&&query.isError), retryLoad:query.refetch, saveError, saveErrorMessage, conflict, saving, retrySave:()=>void flush(), reloadSaved, deleteAccountData, deletingAccountData:deleteMutation.isPending, deleteAccountError:deleteMutation.isError, byCourse };
}
