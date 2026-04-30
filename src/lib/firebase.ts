import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Connectivity check
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// Simple anonymous sign-in for Telegram users
export const authStatus = { restricted: false };

export const performSignIn = async () => {
  try {
    console.log('Attempting anonymous sign-in...');
    const result = await signInAnonymously(auth);
    console.log('Anonymous sign-in success:', result.user.uid);
  } catch (error: any) {
    if (error.code === 'auth/admin-restricted-operation') {
      authStatus.restricted = true;
      console.error("Firebase Anonymous Auth is NOT enabled in your console. Please go to your Firebase Project -> Authentication -> Sign-in method and enable 'Anonymous'.");
    } else {
      console.error("Error signing in anonymously:", error.code, error.message);
    }
    throw error;
  }
};

// Start sign-in, but don't block exports
performSignIn().catch(() => {});
