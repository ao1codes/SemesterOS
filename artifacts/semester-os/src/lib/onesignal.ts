type OneSignalClient = {
  init(options: { appId: string; allowLocalhostAsSecureOrigin?: boolean; serviceWorkerPath: string; serviceWorkerParam: { scope: string } }): Promise<void>;
  login(externalId: string): Promise<void>;
  logout():Promise<void>;
  Notifications: {
    requestPermission(): Promise<unknown>;
  };
  User: {
    PushSubscription: {
      optIn(): Promise<void>;
      optOut():Promise<void>;
      optedIn: boolean;
    };
  };
};

declare global {
  interface Window {
    OneSignalDeferred?: Array<(client: OneSignalClient) => Promise<void> | void>;
  }
}

let clientReady: Promise<OneSignalClient> | null = null;
let scriptReady: Promise<void> | null = null;
let identityEpoch=0;

function loadOneSignalSdk() {
  if (scriptReady) return scriptReady;
  scriptReady = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    script.async = true;
    script.dataset.onesignalSdk = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      scriptReady = null;
      reject(new Error("The OneSignal browser SDK could not be loaded."));
    };
    document.head.appendChild(script);
  });
  return scriptReady;
}

async function getOneSignalClient(appId: string) {
  if (!clientReady) {
    clientReady = new Promise<OneSignalClient>((resolve, reject) => {
      const queue = (window.OneSignalDeferred ??= []);
      queue.push(async (client) => {
        try {
          const base = import.meta.env.BASE_URL;
          await client.init({
            appId, allowLocalhostAsSecureOrigin: window.location.hostname === "localhost",
            serviceWorkerPath: `${base}OneSignalSDKWorker.js`,
            serviceWorkerParam: { scope: base },
          });
          resolve(client);
        } catch (error) {
          reject(error);
        }
      });
      void loadOneSignalSdk().catch(reject);
    }).catch((error) => {
      clientReady = null;
      throw error;
    });
  }
  return clientReady;
}

export async function enableBrowserPush(externalId: string) {
  const epoch=++identityEpoch;
  const appId = import.meta.env.VITE_ONESIGNAL_APP_ID as string | undefined;
  if (!appId) throw new Error("Browser push is not configured for this app yet.");

  const client = await getOneSignalClient(appId);
  if(epoch!==identityEpoch)throw new Error("Account changed. Enable push again for the current account.");
  await client.login(externalId);
  await client.Notifications.requestPermission();
  if(epoch!==identityEpoch){await client.User.PushSubscription.optOut();await client.logout();throw new Error("Account changed during push setup.");}
  if (Notification.permission !== "granted") {
    throw new Error("Browser notification permission was not granted.");
  }
  await client.User.PushSubscription.optIn();
  if (!client.User.PushSubscription.optedIn) {
    throw new Error("This browser has not completed push registration.");
  }
}

export async function suspendBrowserPush() {
  ++identityEpoch;
  if(!clientReady)return;
  const client=await clientReady;
  await client.User.PushSubscription.optOut();
  await client.logout();
}
