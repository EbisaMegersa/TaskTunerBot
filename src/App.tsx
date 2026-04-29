import React, { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInAnonymously, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  collection, 
  query, 
  where,
  addDoc,
  serverTimestamp,
  increment,
  runTransaction,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  Home, 
  Trophy, 
  Users, 
  Wallet, 
  User, 
  Gift, 
  Play, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  History,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

interface UserProfile {
  telegramId: number;
  username: string;
  adsWatched: number;
  balance: number;
  dailyStreak: number;
  lastDailyClaim: any;
  tasksCompleted: string[];
  referralsCount: number;
  total_invites: number;
  consumedInvites: number;
  referralEarnings: number;
  invitedBy?: string;
  has_withdrawn: boolean;
  adsSinceLastWithdrawal: number;
  updatedAt: any;
}

interface WithdrawalRequest {
  id?: string;
  amount: number;
  method: string;
  address: string;
  status: 'Pending' | 'Success' | 'Rejected';
  createdAt: any;
  userId: string;
}

// --- Helpers ---
const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

// Mock Telegram Data if not in environment
const getTelegramData = () => {
  // @ts-ignore
  const tg = window.Telegram?.WebApp;
  if (tg?.initDataUnsafe?.user) {
    // Priority: start_param (used by startapp=USER_ID or start=USER_ID)
    const startParam = tg.initDataUnsafe.start_param;
    return {
      username: tg.initDataUnsafe.user.username || tg.initDataUnsafe.user.first_name,
      id: tg.initDataUnsafe.user.id,
      startParam: startParam || undefined
    };
  }
  return {
    username: 'DemoUser_' + Math.floor(Math.random() * 1000),
    id: 12345678,
    startParam: new URLSearchParams(window.location.search).get('start') || undefined
  };
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [error, setError] = useState<string | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawWallet, setWithdrawWallet] = useState('');
  const [lastRefCount, setLastRefCount] = useState<number | null>(null);

  // Referral Notification Effect
  useEffect(() => {
    if (profile?.referralsCount !== undefined) {
      if (lastRefCount !== null && profile.referralsCount > lastRefCount) {
        // Show notification (simple alert for now, or we could add a toast state)
        alert("🎉 Someone joined using your link! +$0.35 has been added to your balance.");
      }
      setLastRefCount(profile.referralsCount);
    }
  }, [profile?.referralsCount]);

  // 1. Auth & Profile Initialization
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        setUser(fbUser);
        const { username, id, startParam } = getTelegramData();
        
        const userRef = doc(db, 'users', fbUser.uid);
        
        try {
          // Connection test as required
          await getDocFromServer(doc(db, 'test', 'connection')).catch(() => {});

          const userDoc = await getDoc(userRef);
          
          if (!userDoc.exists()) {
            // New User Implementation
            const newProfile: any = {
              telegramId: id,
              username: username,
              adsWatched: 0,
              balance: 0,
              dailyStreak: 0,
              lastDailyClaim: null,
              tasksCompleted: [],
              referralsCount: 0,
              total_invites: 0,
              consumedInvites: 0,
              referralEarnings: 0,
              has_withdrawn: false,
              adsSinceLastWithdrawal: 0,
              updatedAt: serverTimestamp(),
            };
            
            if (startParam) {
              newProfile.invitedBy = startParam;
            }
            
            await setDoc(userRef, newProfile);

            // Handle Referral Logic if invitedBy exists
            if (startParam && startParam !== fbUser.uid) {
              const referrerRef = doc(db, 'users', startParam);
              try {
                await updateDoc(referrerRef, {
                  balance: increment(0.35),
                  referralsCount: increment(1),
                  total_invites: increment(1),
                  referralEarnings: increment(0.35),
                  updatedAt: serverTimestamp()
                });
                
                // Add to referrals subcollection
                await addDoc(collection(referrerRef, 'referrals'), {
                  telegramId: id,
                  username: username,
                  joinedAt: serverTimestamp()
                });
              } catch (e) {
                console.error("Referral update failed", e);
              }
            }
          }
          
          // Listen for profile changes
          onSnapshot(userRef, (snap) => {
            if (snap.exists()) {
              setProfile(snap.data() as UserProfile);
            }
          }, (err) => handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`));

          setLoading(false);
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${fbUser.uid}`);
          setError("Failed to initialize user data.");
          setLoading(false);
        }
      } else {
        signInAnonymously(auth).catch((err) => {
          setError("Anonymous authentication disabled. Please enable it in Firebase console.");
          setLoading(false);
        });
      }
    });

    return () => unsub();
  }, []);

  // 2. Withdrawal History
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'users', user.uid, 'withdrawals'), where('userId', '==', user.uid));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithdrawalRequest));
      setWithdrawals(docs.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis()));
    }, (err) => handleFirestoreError(err, OperationType.GET, `users/${user.uid}/withdrawals`));
    return () => unsub();
  }, [user]);

  // --- Actions ---

  const claimDaily = async () => {
    if (!user || !profile) return;
    
    const now = new Date();
    const lastClaim = profile.lastDailyClaim?.toDate();
    
    if (lastClaim && now.getTime() - lastClaim.getTime() < 24 * 60 * 60 * 1000) {
      alert("Come back tomorrow!");
      return;
    }

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        balance: increment(0.10),
        dailyStreak: increment(1),
        lastDailyClaim: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const watchAd = async () => {
    if (!user || !profile) return;
    
    // Simulate Ad watching
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        balance: increment(0.02),
        adsWatched: increment(1),
        adsSinceLastWithdrawal: increment(1),
        updatedAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    }
  };

  const handleWithdraw = async () => {
    if (!user || !profile) return;
    const amount = parseFloat(withdrawAmount);
    
    if (isNaN(amount) || amount < 5) {
      setError("Minimum withdrawal is $5.00.");
      return;
    }
    if (amount > profile.balance) {
      setError("Insufficient balance.");
      return;
    }
    if (!withdrawWallet) {
      setError("Please enter your wallet address.");
      return;
    }

    setWithdrawing(true);
    try {
      await runTransaction(db, async (transaction) => {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await transaction.get(userRef);
        
        if (!userSnap.exists()) throw new Error("User does not exist");
        
        const currentBalance = userSnap.data().balance;
        if (currentBalance < amount) throw new Error("Insufficient balance");
        
        const withdrawalRef = doc(collection(userRef, 'withdrawals'));
        transaction.set(withdrawalRef, {
          amount,
          method: 'USDT',
          address: withdrawWallet,
          status: 'Pending',
          createdAt: serverTimestamp(),
          userId: user.uid
        });
        
        transaction.update(userRef, {
          balance: currentBalance - amount,
          has_withdrawn: true,
          adsSinceLastWithdrawal: 0,
          updatedAt: serverTimestamp()
        });
      });
      
      setWithdrawAmount('');
      setWithdrawWallet('');
      setWithdrawing(false);
      setError(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/withdrawals`);
      setWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0D0D0D] text-white">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full mb-4"
        />
        <p className="text-slate-gray animate-pulse font-medium">Securing connection to rewards gateway...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0D0D0D] p-6 text-center">
        <AlertCircle className="w-16 h-16 text-primary mb-4" />
        <h2 className="text-xl font-bold mb-2">Connection Issues</h2>
        <p className="text-slate-gray mb-6">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="bg-primary px-6 py-3 rounded-xl font-bold hover:scale-105 transition-transform"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#0D0D0D] text-white font-sans max-w-md mx-auto pb-24">
      {/* Header */}
      <header className="p-6 sticky top-0 bg-[#0D0D0D]/80 backdrop-blur-md z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-white">
              {activeTab === 'home' ? `Hello, ${profile?.username || 'User'}!` : 
               activeTab === 'tasks' ? 'Tasks' :
               activeTab === 'invite' ? 'Invite & Earn' :
               activeTab === 'wallet' ? 'Wallet' : 'Profile'}
            </h1>
            <p className="text-slate-gray text-sm">
              {activeTab === 'home' ? "Let's earn some cash today!" : 
               activeTab === 'tasks' ? "Complete tasks for massive rewards" :
               activeTab === 'invite' ? "Earn $0.35 per referral" :
               activeTab === 'wallet' ? "Cash out your hard-earned earnings" : "Manage your account stats"}
            </p>
          </div>
          {activeTab === 'home' && (
            <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-primary" />
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 p-6 space-y-6 overflow-y-auto">
        <AnimatePresence mode="wait">
          {activeTab === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Welcome Message for New Users */}
              {!profile?.has_withdrawn && profile?.total_invites === 0 && profile?.adsWatched === 0 && (
                <div className="bg-primary/10 border border-primary/20 p-4 rounded-2xl">
                  <h4 className="text-primary font-bold text-sm mb-1 uppercase tracking-wider">Welcome to Tasktuner! 🎉</h4>
                  <p className="text-slate-gray text-xs">Start earning by watching ads, completing tasks, and inviting friends. Minimum withdrawal is $5.00.</p>
                </div>
              )}

              {/* Balance Card */}
              <div className="gradient-card rounded-3xl p-8 shadow-2xl shadow-primary/20">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-white/80 font-medium">Available Balance</span>
                  <div className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold text-white uppercase tracking-wider">
                    USD Account
                  </div>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold text-white/70">$</span>
                  <h2 className="text-6xl font-black text-white">{profile?.balance.toFixed(2) || '0.00'}</h2>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="stats-card p-5 rounded-2xl">
                  <div className="flex items-center gap-2 text-slate-gray mb-1">
                    <Users className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Friends</span>
                  </div>
                  <p className="text-2xl font-black">{profile?.total_invites || 0}</p>
                </div>
                <div className="stats-card p-5 rounded-2xl">
                  <div className="flex items-center gap-2 text-slate-gray mb-1">
                    <Play className="w-4 h-4" />
                    <span className="text-xs font-bold uppercase tracking-widest">Ads</span>
                  </div>
                  <p className="text-2xl font-black">{profile?.adsWatched || 0}</p>
                </div>
              </div>

              {/* Daily Reward Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg flex items-center gap-2">
                    <Gift className="w-5 h-5 text-primary" />
                    Daily Reward
                  </h3>
                  <span className="text-xs font-bold text-slate-gray uppercase">Streak: {profile?.dailyStreak || 0} Days</span>
                </div>
                <div 
                  onClick={claimDaily}
                  className="stats-card p-6 rounded-2xl flex items-center justify-between group cursor-pointer hover:border-primary/30 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Gift className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-bold">Daily Check-in</h4>
                      <p className="text-slate-gray text-xs">Claim your daily $0.10</p>
                    </div>
                  </div>
                  <button className="bg-primary/10 text-primary px-4 py-2 rounded-xl text-sm font-bold group-hover:bg-primary group-hover:text-white transition-colors">
                    Claim
                  </button>
                </div>
              </section>

              {/* Ads Section */}
              <section className="space-y-4">
                <h3 className="font-bold text-lg">Watch & Earn</h3>
                <div 
                  onClick={watchAd}
                  className="stats-card p-6 rounded-2xl flex items-center justify-between group cursor-pointer border-dashed border-2 border-slate-gray/20 hover:border-primary/50 transition-all bg-primary/5"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center">
                      <Play className="w-6 h-6 text-primary fill-current" />
                    </div>
                    <div>
                      <h4 className="font-bold">Video Ad</h4>
                      <p className="text-slate-gray text-xs">Earn $0.02 instantly</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-slate-gray group-hover:translate-x-1 transition-transform" />
                </div>
              </section>
            </motion.div>
          )}

          {activeTab === 'tasks' && (
            <motion.div 
              key="tasks"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="bg-primary/10 border border-primary/20 p-4 rounded-2xl">
                <p className="text-primary text-sm font-medium flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  New tasks are added every 24 hours.
                </p>
              </div>

              <div className="space-y-4">
                <h4 className="text-slate-gray text-xs font-bold uppercase tracking-widest px-1">Available Tasks</h4>
                
                {[
                  { id: 'tg_join', title: 'Join @ebisa_emoji', reward: 0.50, type: 'Telegram', link: 'https://t.me/ebisa_emoji' },
                  { id: 'yt_sub', title: 'Subscribe YouTube', reward: 1.00, type: 'YouTube', link: '#' },
                  { id: 'tw_follow', title: 'Follow on X', reward: 0.30, type: 'Social', link: '#' }
                ].map((task) => (
                  <div key={task.id} className="stats-card p-5 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center font-bold text-xs uppercase text-slate-gray">
                        {task.type[0]}
                      </div>
                      <div>
                        <h4 className="font-bold text-sm">{task.title}</h4>
                        <p className="text-primary text-xs font-bold flex items-center gap-1">
                          +${task.reward.toFixed(2)}
                        </p>
                      </div>
                    </div>
                    <a 
                      href={task.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-white text-black px-4 py-2 rounded-xl text-xs font-black shadow-lg"
                    >
                      GO
                    </a>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'invite' && (
            <motion.div 
              key="invite"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-6"
            >
              <div className="stats-card p-10 rounded-3xl text-center border-primary/20 border-2">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Users className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-3xl font-black mb-4">Invite & Earn</h2>
                <p className="text-slate-gray mb-8">Earn $0.35 for every friend who starts earning with us. No limits!</p>
                
                <div className="flex gap-2">
                   <div className="flex-1 bg-white/5 p-4 rounded-xl border border-white/10 text-sm font-mono truncate">
                    t.me/Tasktuner_bot?startapp={user?.uid}
                   </div>
                   <button 
                    onClick={() => {
                      navigator.clipboard.writeText(`https://t.me/Tasktuner_bot?startapp=${user?.uid}`);
                      alert("Link copied!");
                    }}
                    className="bg-primary text-white p-4 rounded-xl font-bold"
                   >
                     Copy
                   </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="stats-card p-6 rounded-2xl text-center">
                  <p className="text-xs font-bold uppercase text-slate-gray mb-1">Referrals</p>
                  <p className="text-3xl font-black">{profile?.total_invites || 0}</p>
                </div>
                <div className="stats-card p-6 rounded-2xl text-center">
                  <p className="text-xs font-bold uppercase text-slate-gray mb-1">Earnings</p>
                  <p className="text-3xl font-black text-primary">${(profile?.referralEarnings || 0).toFixed(2)}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl border border-white/5 italic text-sm text-slate-gray">
                <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                "Our system verifies every referral instantly. You get paid $0.35 the moment they open the app."
              </div>
            </motion.div>
          )}

          {activeTab === 'wallet' && (
            <motion.div 
              key="wallet"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="stats-card p-6 rounded-3xl space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-gray block ml-1">Withdraw Amount (Min $5.00)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-slate-gray">$</span>
                    <input 
                      type="number"
                      placeholder="0.00"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 pl-8 text-white font-bold placeholder:text-slate-gray/50 focus:border-primary outline-none transition-colors"
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-gray block ml-1">USDT Wallet Address (BEP20)</label>
                  <input 
                    type="text"
                    placeholder="Ox..."
                    value={withdrawWallet}
                    onChange={(e) => setWithdrawWallet(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 text-white font-mono placeholder:text-slate-gray/50 focus:border-primary outline-none transition-colors"
                  />
                </div>

                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs font-medium text-slate-gray">
                    Withdrawals are processed within 24 hours. Ensure your wallet address is correct. Min Required: $5.00.
                  </p>
                </div>

                <button 
                  onClick={handleWithdraw}
                  disabled={withdrawing || profile!.balance < 5}
                  className={`w-full py-5 rounded-2xl font-black text-xl transition-all ${
                    withdrawing || profile!.balance < 5 
                    ? 'bg-white/5 text-slate-gray cursor-not-allowed' 
                    : 'bg-primary text-white shadow-xl shadow-primary/30 hover:scale-[1.02] active:scale-95'
                  }`}
                >
                  {withdrawing ? 'Processing...' : 'Withdraw Rewards'}
                </button>
              </div>

              <div className="space-y-4">
                <h4 className="text-slate-gray text-xs font-bold uppercase tracking-widest px-1 flex items-center gap-2">
                   <History className="w-4 h-4" />
                   Withdrawal History
                </h4>
                {withdrawals.length === 0 ? (
                  <div className="stats-card p-12 rounded-3xl text-center text-slate-gray italic text-sm">
                    No withdrawal history yet.
                  </div>
                ) : (
                  withdrawals.map((item) => (
                    <div key={item.id} className="stats-card p-5 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                          item.status === 'Success' ? 'bg-green-500/10 text-green-500' : 
                          item.status === 'Rejected' ? 'bg-red-500/10 text-red-500' : 'bg-primary/10 text-primary'
                        }`}>
                          <Wallet className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm">${item.amount.toFixed(2)}</h4>
                          <p className="text-slate-gray text-[10px] font-bold uppercase tracking-wider">
                            {item.createdAt?.toMillis ? new Date(item.createdAt.toMillis()).toLocaleDateString() : 'Processing...'}
                          </p>
                        </div>
                      </div>
                      <div className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${
                          item.status === 'Success' ? 'bg-green-500/10 text-green-500' : 
                          item.status === 'Rejected' ? 'bg-red-500/10 text-red-500' : 'bg-primary/20 text-primary'
                      }`}>
                        {item.status}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'profile' && (
            <motion.div 
              key="profile"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="stats-card p-8 rounded-3xl text-center">
                <div className="w-24 h-24 bg-gradient-to-br from-primary to-secondary rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-[#0D0D0D] shadow-xl">
                  <User className="w-12 h-12 text-white" />
                </div>
                <h2 className="text-2xl font-black">{profile?.username || 'User'}</h2>
                <p className="text-primary text-sm font-bold uppercase tracking-widest">Premium Earner</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Balance', value: `$${(profile?.balance || 0).toFixed(2)}`, color: 'text-white' },
                  { label: 'Invites', value: profile?.total_invites || 0, color: 'text-white' },
                  { label: 'Total Ads', value: profile?.adsWatched || 0, color: 'text-white' },
                  { label: 'Total Earned', value: `$${((profile?.balance || 0) + withdrawals.reduce((acc, curr) => acc + (curr.status === 'Success' ? curr.amount : 0), 0)).toFixed(2)}`, color: 'text-primary' }
                ].map((stat) => (
                  <div key={stat.label} className="stats-card p-5 rounded-2xl">
                    <p className="text-xs font-bold uppercase text-slate-gray mb-1">{stat.label}</p>
                    <p className={`text-2xl font-black ${stat.color}`}>{stat.value}</p>
                  </div>
                ))}
              </div>

              <section className="space-y-4">
                <h4 className="text-slate-gray text-xs font-bold uppercase tracking-widest px-1">Support & Help</h4>
                <div className="space-y-2">
                  <a href="https://t.me/ebisa_emoji" target="_blank" className="stats-card p-5 rounded-2xl flex items-center justify-between group">
                    <span className="font-bold">Join Community</span>
                    <ExternalLink className="w-4 h-4 text-slate-gray group-hover:text-primary" />
                  </a>
                  <div className="stats-card p-5 rounded-2xl flex items-center justify-between opacity-50">
                    <span className="font-bold">Usage Policy</span>
                    <ChevronRight className="w-4 h-4 text-slate-gray" />
                  </div>
                </div>
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 nav-blur z-20 pb-8 px-4 flex justify-between items-center max-w-md mx-auto">
        {[
          { id: 'home', icon: Home, label: 'Home' },
          { id: 'tasks', icon: Trophy, label: 'Tasks' },
          { id: 'invite', icon: Users, label: 'Invite' },
          { id: 'wallet', icon: Wallet, label: 'Withdraw' },
          { id: 'profile', icon: User, label: 'Profile' }
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center p-3 rounded-2xl transition-all ${
              activeTab === item.id ? 'text-primary scale-110' : 'text-slate-gray opacity-60 hover:opacity-100'
            }`}
          >
            <item.icon className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-black uppercase tracking-tighter">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
