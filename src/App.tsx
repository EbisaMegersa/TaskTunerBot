/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { 
  MonitorPlay, 
  Loader2, 
  Home, 
  Zap, 
  Users, 
  Wallet, 
  User as UserIcon,
  Play,
  CircleDollarSign,
  ArrowUpRight,
  CheckCircle2,
  Bell,
  Check,
  ExternalLink,
  Share2,
  Gift,
  Copy,
  Clock
} from 'lucide-react';
import { db, auth } from './lib/firebase';
import { doc, setDoc, updateDoc, serverTimestamp, onSnapshot, increment, query, collection, where, getDocs, limit, orderBy, addDoc, writeBatch } from 'firebase/firestore';

// --- Types ---
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
  invitedBy: string | null;
}

interface WithdrawalHistory {
  id: string;
  amount: number;
  method: string;
  status: 'Pending' | 'Success' | 'Rejected';
  createdAt: any;
}

const DAILY_REWARDS = [5, 10, 15, 20, 25, 30, 50]; // Points

// --- Error Handling ---
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

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
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
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface UserData {
  id: number;
  username: string;
}

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [isClaimingDaily, setIsClaimingDaily] = useState(false);
  const [isVerifyingTask, setIsVerifyingTask] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('home');
  const [error, setError] = useState<string | null>(null);
  const [withdrawalMethod, setWithdrawalMethod] = useState('usdt_trc20');
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalAddress, setWithdrawalAddress] = useState('');
  const [withdrawalUid, setWithdrawalUid] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalHistory[]>([]);
  const [withdrawalSuccess, setWithdrawalSuccess] = useState(false);

  // Initialize Telegram & Data
  useEffect(() => {
    let unsubscribeAuth: (() => void) | undefined;
    let unsubscribeProfile: (() => void) | undefined;
    let unsubscribeHistory: (() => void) | undefined;

    const extractStartParam = (tg: any) => {
      if (tg.initDataUnsafe?.start_param) return tg.initDataUnsafe.start_param;
      try {
        const urlParams = new URLSearchParams(tg.initData);
        return urlParams.get('start_param');
      } catch (e) {
        return null;
      }
    };

    const init = async () => {
      const tg = (window as any).Telegram?.WebApp;
      if (!tg) {
        setLoading(false);
        return;
      }

      tg.ready();
      tg.expand();

      if (!tg.initDataUnsafe?.user) {
        setLoading(false);
        return;
      }

      const user = tg.initDataUnsafe.user;
      
      unsubscribeAuth = auth.onAuthStateChanged(async (firebaseUser) => {
        if (!firebaseUser) return;

        // Cleanup existing listeners if any
        unsubscribeProfile?.();
        unsubscribeHistory?.();

        const userDocPath = `users/${firebaseUser.uid}`;
        const inviterIdFromParam = extractStartParam(tg);
        
        const identity = {
          id: user.id,
          username: user.username || user.first_name || 'User'
        };
        setUserData(identity);

        // Profile Listener
        unsubscribeProfile = onSnapshot(doc(db, userDocPath), async (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
              setProfile({
                telegramId: data.telegramId || 0,
                username: data.username || 'User',
                adsWatched: data.adsWatched || 0,
                balance: data.balance || 0,
                dailyStreak: data.dailyStreak || 0,
                lastDailyClaim: data.lastDailyClaim,
                tasksCompleted: data.tasksCompleted || [],
                referralsCount: data.referralsCount || 0,
                total_invites: data.total_invites || 0,
                consumedInvites: data.consumedInvites || 0,
                referralEarnings: data.referralEarnings || 0,
                invitedBy: data.invitedBy || null
              });
            setLoading(false);
          } else {
            // NEW USER REGISTRATION
            try {
              let inviterIdStr = null;
              if (inviterIdFromParam && parseInt(inviterIdFromParam) !== user.id) {
                try {
                  const inviterRef = collection(db, "users");
                  const q = query(inviterRef, where("telegramId", "==", parseInt(inviterIdFromParam)), limit(1));
                  const querySnapshot = await getDocs(q);
                  
                  if (!querySnapshot.empty) {
                    const inviterDoc = querySnapshot.docs[0];
                    inviterIdStr = inviterDoc.id;
                    
                    // Reward inviter (50 pts)
                    await updateDoc(doc(db, "users", inviterDoc.id), {
                      balance: increment(50),
                      referralsCount: increment(1),
                      total_invites: increment(1),
                      referralEarnings: increment(50),
                      updatedAt: serverTimestamp()
                    });

                    // Track in sub-collection
                    await setDoc(doc(db, `users/${inviterDoc.id}/referrals/${user.id}`), {
                      telegramId: user.id,
                      username: identity.username,
                      joinedAt: serverTimestamp()
                    });
                    
                    tg.showAlert(`Welcome to @Madbottherbot! You were successfully referred and can now start earning.`);
                    tg.HapticFeedback?.notificationOccurred('success');
                  }
                } catch (refErr) {
                  console.error("Referral Error:", refErr);
                }
              }
              
              const initialProfile = {
                telegramId: user.id,
                username: identity.username,
                adsWatched: 0,
                balance: 0,
                dailyStreak: 0,
                lastDailyClaim: null,
                tasksCompleted: [],
                referralsCount: 0,
                total_invites: 0,
                consumedInvites: 0,
                referralEarnings: 0,
                invitedBy: inviterIdStr,
                updatedAt: serverTimestamp()
              };
              await setDoc(doc(db, userDocPath), initialProfile);
            } catch (e) {
              console.error("Registration Error", e);
              setError("Failed to create profile. Try refreshing.");
              setLoading(false);
            }
          }
        }, (err) => {
          console.error("Profile Snapshot Error", err);
          setError("Database connection error. Try again later.");
          setLoading(false);
        });

        // Withdrawal History Listener
        const historyRef = collection(db, `${userDocPath}/withdrawals`);
        // Note: orderBy requires index. If it fails, we'll know from console.
        const qHistory = query(historyRef, orderBy('createdAt', 'desc'), limit(20));
        unsubscribeHistory = onSnapshot(qHistory, (snapshot) => {
          const history = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          } as WithdrawalHistory));
          setWithdrawalHistory(history);
        }, (err) => {
          console.error("History Snapshot Error:", err);
          // Fallback query if orderBy fails (no index yet?)
          onSnapshot(query(historyRef, limit(20)), (snap) => {
             const history = snap.docs.map(d => ({ id: d.id, ...d.data() } as WithdrawalHistory));
             // Manual client-side sort as fallback
             history.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
             setWithdrawalHistory(history);
          });
        });
      });
    };

    init();
    return () => {
      unsubscribeAuth?.();
      unsubscribeProfile?.();
      unsubscribeHistory?.();
    };
  }, []);

  const handleWatchAd = async () => {
    if (isWatching || !auth.currentUser) return;
    
    setIsWatching(true);

    const rewardUser = async () => {
      if (!auth.currentUser) return;
      const userDocPath = `users/${auth.currentUser.uid}`;
      try {
        await updateDoc(doc(db, userDocPath), {
          adsWatched: increment(1),
          balance: increment(2), // 2 points per ad
          updatedAt: serverTimestamp()
        });
        
        try {
          (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
        } catch {}
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, userDocPath);
      } finally {
        setIsWatching(false);
      }
    };
    
    const adFn = (window as any).show_10937696;
    if (typeof adFn === 'function') {
      try {
        adFn().then(() => {
          rewardUser();
        }).catch((err: any) => {
          console.error("Ad SDK error:", err);
          setIsWatching(false);
        });
      } catch (err) {
        console.error("Ad SDK sync error:", err);
        setIsWatching(false);
      }
    } else {
      setTimeout(rewardUser, 3000);
    }
  };

  const handleDailyCheckIn = async () => {
    if (isClaimingDaily || !auth.currentUser || !profile) return;
    
    const now = Date.now();
    const lastClaim = profile.lastDailyClaim ? profile.lastDailyClaim.toMillis() : 0;
    const diffHours = (now - lastClaim) / (1000 * 60 * 60);

    // Can only claim once every 24 hours
    if (diffHours < 24 && profile.lastDailyClaim) {
      alert(`Come back in ${Math.ceil(24 - diffHours)} hours!`);
      return;
    }

    setIsClaimingDaily(true);
    const userDocPath = `users/${auth.currentUser.uid}`;

    try {
      let newStreak = profile.dailyStreak;
      
      // If claimed more than 48 hours ago, reset streak (missed a day)
      // Or if it's the very first claim
      if (diffHours > 48 || !profile.lastDailyClaim) {
        newStreak = 1;
      } else {
        newStreak = (newStreak % 7) + 1;
      }

      const reward = DAILY_REWARDS[newStreak - 1];

      await updateDoc(doc(db, userDocPath), {
        balance: increment(reward),
        dailyStreak: newStreak,
        lastDailyClaim: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      try {
        (window as any).Telegram?.WebApp?.HapticFeedback?.impactOccurred('medium');
      } catch {}

      alert(`Day ${newStreak} Claimed! Reward: ${reward} points`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userDocPath);
    } finally {
      setIsClaimingDaily(false);
    }
  };

  const handleJoinTelegram = async () => {
    if (isVerifyingTask || !auth.currentUser || !profile) return;
    if (profile.tasksCompleted.includes('tg_join')) {
      alert("Task already completed!");
      return;
    }

    setIsVerifyingTask(true);
    const userDocPath = `users/${auth.currentUser.uid}`;

    try {
      // Small delay to simulate verification
      await new Promise(resolve => setTimeout(resolve, 2000));

      await updateDoc(doc(db, userDocPath), {
        balance: increment(5), // 5 points for joining channel
        tasksCompleted: [...profile.tasksCompleted, 'tg_join'],
        updatedAt: serverTimestamp()
      });

      try {
        (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      } catch {}
      alert("Successfully verified! 5 points added to your balance.");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, userDocPath);
    } finally {
      setIsVerifyingTask(false);
    }
  };

  const referralLink = profile ? `https://t.me/Madbottherbot?startapp=${profile.telegramId}` : '';

  const handleCopyLink = () => {
    navigator.clipboard.writeText(referralLink);
    try {
      (window as any).Telegram?.WebApp?.showAlert('Referral link copied to clipboard!');
      (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
    } catch {
      alert('Copied!');
    }
  };

  const handleShare = () => {
    const text = encodeURIComponent("Join this bot and earn rewards! \ud83d\ude80");
    const url = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`;
    (window as any).Telegram?.WebApp?.openTelegramLink(url);
  };

  const handleWithdraw = async () => {
    if (!profile || !auth.currentUser || isWithdrawing) return;

    const amountNum = parseFloat(withdrawalAmount);
    
    // 1. Minimum Amount Check
    if (isNaN(amountNum) || amountNum < 30) {
      alert('Minimum withdrawal is 30 points.');
      return;
    }

    // 2. Balance Check
    if (amountNum > profile.balance) {
      alert('Insufficient balance.');
      return;
    }

    // 3. Lock System Check
    const availableInvites = (profile.total_invites || 0) - (profile.consumedInvites || 0);
    const meetsInvites = availableInvites >= 2;
    const meetsAds = (profile.adsWatched || 0) >= 25;

    if (!meetsInvites || !meetsAds) {
      if (!meetsInvites) {
        alert(`You need 2 new invites for every withdrawal request. Available: ${availableInvites}/2`);
      } else {
        alert('Requirement not met: You need 25 ad views to unlock withdrawals.');
      }
      try {
        (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      } catch {}
      return;
    }

    // 4. Address Check (only if not Exchange)
    const isExchange = (withdrawalMethod === 'binance');
    if (!isExchange && !withdrawalAddress) {
      alert('Please enter a valid wallet address.');
      return;
    }

    // 5. UID Check for Exchanges
    if (isExchange && !withdrawalUid) {
      alert('UID is required for Exchange withdrawals.');
      return;
    }

    setIsWithdrawing(true);
    const userDocRef = doc(db, `users/${auth.currentUser.uid}`);
    const withdrawalColRef = collection(db, `users/${auth.currentUser.uid}/withdrawals`);
    const newWithdrawalDocRef = doc(withdrawalColRef);

    try {
      // Create Atomic Transaction (Write Batch)
      const batch = writeBatch(db);
      
      // 1. Deduct Balance
      batch.update(userDocRef, {
        balance: increment(-amountNum),
        updatedAt: serverTimestamp()
      });

      // 2. Create History Entry
      batch.set(newWithdrawalDocRef, {
        amount: amountNum,
        method: withdrawalMethod,
        address: withdrawalAddress || null,
        uid: withdrawalUid || null,
        status: 'Pending',
        createdAt: serverTimestamp(),
        userId: auth.currentUser.uid
      });

      // Commit Batch
      await batch.commit();

      setWithdrawalSuccess(true);
      
      try {
        (window as any).Telegram?.WebApp?.showAlert('\ud83c\udf89 Withdrawal Request Submitted!');
        (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
      } catch {}
      
      setWithdrawalAmount('');
      setWithdrawalAddress('');
      setWithdrawalUid('');

      // Automated Transition after 60 seconds (1 minute)
      setTimeout(async () => {
        try {
          const successBatch = writeBatch(db);
          successBatch.update(newWithdrawalDocRef, { status: 'Success' });
          successBatch.update(userDocRef, {
            consumedInvites: increment(2),
            updatedAt: serverTimestamp()
          });
          await successBatch.commit();
          
          try {
             (window as any).Telegram?.WebApp?.showAlert('\u2705 Withdrawal Processed Successfully!');
             (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('success');
          } catch {}
        } catch (err) {
          console.error("Delayed Withdrawal Update Error:", err);
        }
      }, 60000); // 1 minute delay

      // Auto hide success message banner after 5 seconds
      setTimeout(() => setWithdrawalSuccess(false), 5000);
    } catch (err) {
      console.error("Withdrawal Error:", err);
      handleFirestoreError(err, OperationType.WRITE, userDocRef.path);
      try {
        (window as any).Telegram?.WebApp?.showAlert('\u274c Withdrawal failed. Please try again.');
        (window as any).Telegram?.WebApp?.HapticFeedback?.notificationOccurred('error');
      } catch {}
    } finally {
      setIsWithdrawing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0D121F] p-10 text-center">
        <Loader2 className="w-12 h-12 animate-spin text-[#06B6D4] mb-6" />
        <h2 className="text-xl font-black text-white mb-2">Loading @Madbot...</h2>
        <p className="text-sm text-[#A0AEC0]">Securing connection to rewards gateway</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0D121F] p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-[#06B6D4]/10 flex items-center justify-center mb-6">
          <Bell className="w-10 h-10 text-[#06B6D4]" />
        </div>
        <h2 className="text-2xl font-black text-white mb-4">Connection Failed</h2>
        <p className="text-[#06B6D4] text-sm mb-10 leading-relaxed bg-[#06B6D4]/5 p-4 rounded-xl border border-[#06B6D4]/10">
          {error}
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="w-full h-16 rounded-2xl bg-white text-black font-black shadow-xl"
        >
          RETRY CONNECTION
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28 bg-[#0D121F] font-sans selection:bg-[#06B6D4]/30 overflow-x-hidden">
      {/* Header Section */}
      <header className="px-6 pt-6 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            {activeTab === 'home' ? `Hello, ${userData?.username || 'User'}!` : activeTab === 'tasks' ? 'Tasks' : activeTab === 'invite' ? 'Invite' : activeTab === 'wallet' ? 'Withdraw' : 'Profile'}
          </h1>
          <p className="text-sm text-[#A0AEC0] mt-0.5">
            {activeTab === 'home' ? "Let's earn some points today!" : activeTab === 'tasks' ? "Complete tasks to earn more" : activeTab === 'wallet' ? "Cash out your earnings" : "Refer friends to get paid"}
          </p>
        </div>
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#06B6D4] to-[#10B981] flex items-center justify-center border border-white/10 shadow-lg shadow-[#06B6D4]/10 p-0.5">
          <div className="w-full h-full rounded-full bg-[#0D121F] flex items-center justify-center">
             <UserIcon className="w-5 h-5 text-white" />
          </div>
        </div>
      </header>

      <main className="px-6 space-y-6">
        {activeTab === 'home' ? (
          <>
            {/* Main Balance Card */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="gradient-card rounded-[24px] p-6 text-white shadow-xl shadow-[#06B6D4]/10"
            >
              <div className="relative z-10">
                <p className="text-sm font-medium opacity-80 uppercase tracking-widest">Current Balance</p>
                <h2 className="text-4xl font-extrabold mt-1 tracking-tight">
                  {Math.floor(profile?.balance || 0)} points
                </h2>
                
                <div className="mt-8 grid grid-cols-3 gap-4 border-t border-white/20 pt-6">
                  <div className="text-center">
                    <p className="text-[10px] uppercase font-bold opacity-60 tracking-wider">Total Friends</p>
                    <p className="text-sm font-bold mt-1">{profile?.total_invites || 0}</p>
                  </div>
                  <div className="text-center border-x border-white/10 px-2">
                    <p className="text-[10px] uppercase font-bold opacity-60 tracking-wider">Ads Watched</p>
                    <p className="text-sm font-bold mt-1">{profile?.adsWatched || 0}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-[10px] uppercase font-bold opacity-60 tracking-wider">Tasks Done</p>
                    <p className="text-sm font-bold mt-1">{profile?.tasksCompleted.length || 0}</p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Action Button */}
            <motion.button 
              whileTap={{ scale: 0.98 }}
              onClick={handleWatchAd}
              disabled={isWatching}
              className="w-full h-14 rounded-2xl bg-gradient-to-r from-[#06B6D4] to-[#0891B2] flex items-center justify-center gap-3 text-white font-bold shadow-lg shadow-[#06B6D4]/20 disabled:opacity-70 disabled:cursor-not-allowed group transition-all"
            >
              {isWatching ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Play className="w-5 h-5 fill-current" />
              )}
              <span className="text-lg">{isWatching ? 'Watching...' : 'Watch Video Ad'}</span>
            </motion.button>

            {/* Daily Rewards Sneak Peek */}
            <section className="stats-card rounded-2xl p-4 flex items-center gap-4 cursor-pointer" onClick={() => setActiveTab('tasks')}>
              <div className="w-12 h-12 rounded-xl bg-[#06B6D4]/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-[#06B6D4]" />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-sm">Daily Reward</h4>
                <p className="text-xs text-[#A0AEC0]">Current Streak: {profile?.dailyStreak || 0} Days</p>
              </div>
              <div className="px-3 py-1 rounded-full bg-[#06B6D4]/10 text-[#06B6D4] text-[10px] font-bold border border-[#06B6D4]/20 uppercase">
                 View Tasks
              </div>
            </section>
          </>
        ) : activeTab === 'tasks' ? (
          <div className="space-y-6">
            {/* Daily Check-in Card */}
            <section className="stats-card rounded-3xl p-6 bg-gradient-to-b from-white/[0.05] to-transparent">
               <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="font-bold text-base">Daily Check-in</h3>
                    <p className="text-xs text-[#A0AEC0]">Claim your daily reward</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-[#06B6D4]">{profile?.dailyStreak}/7 Days</p>
                    <div className="w-20 h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden">
                       <div 
                        className="h-full bg-[#06B6D4]" 
                        style={{ width: `${((profile?.dailyStreak || 0) / 7) * 100}%` }}
                       />
                    </div>
                  </div>
               </div>

               <div className="grid grid-cols-7 gap-2 mb-6">
                 {Array.from({ length: 7 }).map((_, i) => {
                   const day = i + 1;
                   const isCompleted = day <= (profile?.dailyStreak || 0);
                   const isCurrent = day === ((profile?.dailyStreak || 0) % 7) + 1;
                   
                   return (
                     <div key={day} className="flex flex-col items-center gap-2">
                        <div className={`w-full aspect-square rounded-xl flex items-center justify-center text-[10px] font-bold border transition-all
                          ${isCompleted ? 'bg-[#06B6D4] border-[#06B6D4] text-white' : 
                            isCurrent ? 'bg-white/5 border-[#06B6D4] text-[#06B6D4] shadow-[0_0_10px_rgba(6,182,212,0.2)]' : 
                            'bg-white/5 border-white/10 text-[#A0AEC0]'}`}
                        >
                          {isCompleted ? <Check className="w-4 h-4" /> : `Day ${day}`}
                        </div>
                        <span className={`text-[8px] font-bold ${isCurrent ? 'text-[#06B6D4]' : 'text-[#A0AEC0]'}`}>
                          {DAILY_REWARDS[i]} pts
                        </span>
                     </div>
                   );
                 })}
               </div>

               <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleDailyCheckIn}
                disabled={isClaimingDaily}
                className="w-full py-3 rounded-xl bg-[#06B6D4] text-white text-sm font-bold shadow-lg shadow-[#06B6D4]/20 disabled:opacity-50"
               >
                 {isClaimingDaily ? 'Claiming...' : 'Claim Today\'s Reward'}
               </motion.button>
            </section>

            {/* Tasks List */}
            <h4 className="font-bold text-sm px-1">Available Tasks</h4>
            
            <div className="space-y-4">
               {/* Telegram Join Task */}
               <div className="stats-card rounded-2xl p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <Users className="w-6 h-6 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                       <h4 className="font-bold text-sm">Join @ebisa_emoji</h4>
                       {profile?.tasksCompleted.includes('tg_join') && (
                         <CheckCircle2 className="w-3 h-3 text-green-400" />
                       )}
                    </div>
                    <p className="text-xs text-[#A0AEC0]">Reward: 5 points | Single Use</p>
                  </div>
                  
                  {!profile?.tasksCompleted.includes('tg_join') ? (
                    <div className="flex flex-col gap-2">
                      <a 
                        href="https://t.me/ebisa_emoji" 
                        target="_blank" 
                        rel="noreferrer"
                        className="px-4 py-1.5 rounded-lg bg-[#06B6D4]/20 text-[#06B6D4] text-[10px] font-bold border border-[#06B6D4]/20 text-center flex items-center gap-1"
                      >
                         Join <ExternalLink size={10} />
                      </a>
                      <button 
                        onClick={handleJoinTelegram}
                        disabled={isVerifyingTask}
                        className="px-4 py-1.5 rounded-lg bg-white/10 text-white text-[10px] font-bold border border-white/10 disabled:opacity-50"
                      >
                         {isVerifyingTask ? '...' : 'Verify'}
                      </button>
                    </div>
                  ) : (
                    <div className="px-4 py-2 rounded-lg bg-green-500/10 text-green-400 text-[10px] font-bold border border-green-500/10">
                       Success
                    </div>
                  )}
               </div>
            </div>
          </div>
        ) : activeTab === 'wallet' ? (
          <div className="space-y-6 pb-10">
            <h2 className="text-2xl font-black text-white px-2">Withdraw</h2>
            
            {/* Status Section */}
            <div className="grid grid-cols-1 gap-3">
              <div className="stats-card rounded-2xl p-5 border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${((profile?.total_invites || 0) - (profile?.consumedInvites || 0)) >= 2 ? 'bg-green-500/10 text-green-400' : 'bg-white/10 text-white/40'}`}>
                   {((profile?.total_invites || 0) - (profile?.consumedInvites || 0)) >= 2 ? <Check size={16} /> : <Users size={16} />}
                  </div>
                  <div>
                    <span className="text-xs font-bold block">Invites Available</span>
                    <p className="text-[10px] opacity-40 uppercase font-medium">For next withdrawal</p>
                  </div>
                </div>
                <span className={`text-xs font-black ${((profile?.total_invites || 0) - (profile?.consumedInvites || 0)) >= 2 ? 'text-green-400' : 'text-[#06B6D4]'}`}>
                  {Math.max(0, (profile?.total_invites || 0) - (profile?.consumedInvites || 0))}/2
                </span>
              </div>
              
              <div className="stats-card rounded-2xl p-5 border border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${(profile?.adsWatched || 0) >= 25 ? 'bg-green-500/10 text-green-400' : 'bg-white/10 text-[#A0AEC0]'}`}>
                   {(profile?.adsWatched || 0) >= 25 ? <Check size={16} /> : <MonitorPlay size={16} />}
                  </div>
                  <span className="text-xs font-bold">Ads Watched</span>
                </div>
                <span className={`text-xs font-black ${(profile?.adsWatched || 0) >= 25 ? 'text-green-400' : 'text-[#06B6D4]'}`}>
                  {profile?.adsWatched || 0}/25
                </span>
              </div>
            </div>

            {/* Success Message Banner */}
            {withdrawalSuccess && (
               <motion.div 
                 initial={{ opacity: 0, y: -20 }}
                 animate={{ opacity: 1, y: 0 }}
                 className="p-4 bg-green-500/20 border border-green-500/30 rounded-2xl text-center"
               >
                 <p className="text-green-400 text-xs font-black uppercase tracking-widest">\ud83c\udf89 Withdrawal Request Submitted!</p>
               </motion.div>
            )}

            {/* Selection Menu */}
            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <label className="text-[10px] font-black text-[#A0AEC0] uppercase tracking-[0.2em]">Method</label>
                {withdrawalMethod && (
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-bold text-white/40 uppercase">Selected:</span>
                    <span className="text-[8px] font-black text-[#06B6D4] uppercase">{withdrawalMethod.replace('_', ' ')}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'usdt_trc20', label: 'USDT (TRC20)', img: 'https://cryptologos.cc/logos/tether-usdt-logo.png' },
                  { id: 'usdt_bep20', label: 'USDT (BEP20)', img: 'https://cryptologos.cc/logos/tether-usdt-logo.png' },
                  { id: 'ton', label: 'TON', img: 'https://cryptologos.cc/logos/toncoin-ton-logo.png' },
                  { id: 'binance', label: 'Binance', img: 'https://upload.wikimedia.org/wikipedia/commons/e/e8/Binance_Logo.svg' },
                ].map((m) => (
                  <button 
                    key={m.id}
                    onClick={() => setWithdrawalMethod(m.id)}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-2 transition-all ${withdrawalMethod === m.id ? 'bg-[#06B6D4]/10 border-[#06B6D4] shadow-[0_0_15px_rgba(6,182,212,0.2)]' : 'bg-white/5 border-white/5'}`}
                  >
                    <img src={m.img} alt={m.label} className="w-6 h-6 object-contain" referrerPolicy="no-referrer" />
                    <span className="text-[8px] font-black uppercase text-center leading-tight whitespace-pre-wrap">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Input Form */}
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-[#A0AEC0] uppercase tracking-[0.2em] ml-1">Amount (Min. 30 pts)</label>
                <div className="relative">
                  <input 
                    type="number"
                    value={withdrawalAmount}
                    onChange={(e) => setWithdrawalAmount(e.target.value)}
                    placeholder="E.g. 100"
                    className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-5 text-sm text-white focus:outline-none focus:border-[#06B6D4]/50 transition-all"
                  />
                  <div className="absolute right-5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#A0AEC0]">PTS</div>
                </div>
              </div>

              {!(withdrawalMethod === 'binance') ? (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-[#A0AEC0] uppercase tracking-[0.2em] ml-1">Wallet Address / Network</label>
                  <input 
                    type="text"
                    value={withdrawalAddress}
                    onChange={(e) => setWithdrawalAddress(e.target.value)}
                    placeholder="Enter your wallet address"
                    className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-5 text-sm text-white focus:outline-none focus:border-[#06B6D4]/50 transition-all font-mono"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-[#A0AEC0] uppercase tracking-[0.2em] ml-1">Exchange UID</label>
                  <input 
                    type="text"
                    value={withdrawalUid}
                    onChange={(e) => setWithdrawalUid(e.target.value)}
                    placeholder="Enter your Exchange UID"
                    className="w-full h-14 bg-white/5 border border-white/10 rounded-2xl px-5 text-sm text-white focus:outline-none focus:border-[#06B6D4]/50 transition-all font-mono"
                  />
                </div>
              )}
            </div>

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleWithdraw}
              disabled={isWithdrawing || !profile || profile.balance < 30}
              className={`w-full h-16 rounded-2xl font-black text-white shadow-lg transition-all flex items-center justify-center gap-3
                ${(((profile?.total_invites || 0) - (profile?.consumedInvites || 0)) >= 2 && (profile?.adsWatched || 0) >= 25) 
                  ? 'bg-gradient-to-r from-[#06B6D4] to-[#10B981] shadow-[#06B6D4]/20' 
                  : 'bg-white/10 border border-white/5 text-white/20'}`}
            >
              {isWithdrawing ? (
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>PROCESSING...</span>
                </div>
              ) : ((((profile?.total_invites || 0) - (profile?.consumedInvites || 0)) >= 2 && (profile?.adsWatched || 0) >= 25) ? (
                'WITHDRAW NOW'
              ) : (
                <>
                  <Wallet size={20} />
                  <span>
                    {((profile?.total_invites || 0) - (profile?.consumedInvites || 0)) < 2 
                      ? '2 INVITES REQUIRED' 
                      : 'ADS WATCHED REQ.'}
                  </span>
                </>
              ))}
            </motion.button>

            {/* History Section */}
            <div className="mt-12 space-y-4">
               <div className="flex items-center gap-2 px-2">
                 <Clock size={16} className="text-[#06B6D4]" />
                 <h3 className="text-lg font-black text-white uppercase tracking-tight">Withdrawal History</h3>
               </div>

               {withdrawalHistory.length === 0 ? (
                 <div className="stats-card rounded-3xl p-10 text-center border border-white/5">
                   <p className="text-[#A0AEC0] text-sm opacity-60">No withdrawal history yet.</p>
                 </div>
               ) : (
                 <div className="space-y-3">
                   {withdrawalHistory.map((item) => {
                     const methodIcon = [
                        { id: 'usdt_trc20', img: 'https://cryptologos.cc/logos/tether-usdt-logo.png' },
                        { id: 'usdt_bep20', img: 'https://cryptologos.cc/logos/tether-usdt-logo.png' },
                        { id: 'ton', img: 'https://cryptologos.cc/logos/toncoin-ton-logo.png' },
                        { id: 'binance', img: 'https://upload.wikimedia.org/wikipedia/commons/e/e8/Binance_Logo.svg' },
                     ].find(m => m.id === item.method)?.img;

                     return (
                       <div key={item.id} className="stats-card rounded-[24px] p-5 flex items-center justify-between border border-white/5">
                          <div className="flex items-center gap-4">
                             <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center p-2.5">
                               <img src={methodIcon} alt={item.method} className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                             </div>
                             <div>
                               <p className="text-sm font-black text-white uppercase tracking-tight">{item.amount} PTS</p>
                               <p className="text-[9px] font-bold text-[#A0AEC0] uppercase opacity-60">
                                 {item.createdAt?.toMillis ? new Date(item.createdAt.toMillis()).toLocaleDateString() : 'Processing...'}
                               </p>
                             </div>
                          </div>
                          <div className="text-right">
                             <div className={`px-2.5 py-1 rounded-full text-[8px] font-black uppercase tracking-widest flex items-center gap-1.5
                               ${item.status === 'Pending' ? 'bg-yellow-500/10 text-yellow-500' : 
                                 item.status === 'Success' ? 'bg-green-500/10 text-green-500' : 
                                 'bg-red-500/10 text-red-500'}`}
                             >
                                <span className="w-1 h-1 rounded-full bg-current shadow-[0_0_5px_currentColor]" />
                                {item.status === 'Success' ? 'Success \u2705' : item.status}
                             </div>
                          </div>
                       </div>
                     );
                   })}
                 </div>
               )}
            </div>
          </div>

        ) : activeTab === 'profile' ? (
          <div className="space-y-6">
            <h2 className="text-2xl font-black text-white px-2">Profile</h2>
            <div className="bg-white/5 rounded-[32px] p-8 border border-white/10 relative overflow-hidden">
              <div className="relative z-10">
                <div className="flex items-center gap-6 mb-10">
                  <div className="w-20 h-20 rounded-[24px] bg-gradient-to-tr from-[#06B6D4] to-[#10B981] flex items-center justify-center text-3xl font-black text-white shadow-xl shadow-[#06B6D4]/20">
                    {userData?.username?.[0]?.toUpperCase() || 'U'}
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-white">{userData?.username || 'User'}</h3>
                    <p className="text-xs text-[#06B6D4] font-bold mt-1 tracking-wider uppercase">Active Member</p>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="flex justify-between items-center p-5 bg-black/30 rounded-2xl border border-white/5">
                    <span className="text-xs font-bold opacity-40 uppercase tracking-widest">Telegram ID</span>
                    <span className="text-sm font-mono text-white">{userData?.id}</span>
                  </div>
                  <div className="flex justify-between items-center p-5 bg-black/30 rounded-2xl border border-white/5">
                    <span className="text-xs font-bold opacity-40 uppercase tracking-widest">Reputation</span>
                    <span className="text-sm font-bold text-green-400">Perfect 100%</span>
                  </div>
                  <div className="flex justify-between items-center p-5 bg-black/30 rounded-2xl border border-white/5">
                    <span className="text-xs font-bold opacity-40 uppercase tracking-widest">Status</span>
                    <span className="text-sm font-bold text-[#06B6D4]">Verified Earner</span>
                  </div>
                </div>
              </div>
              
              {/* Decorative backgrounds for profile */}
              <div className="absolute -right-20 -top-20 w-48 h-48 bg-[#06B6D4]/10 rounded-full blur-3xl" />
            </div>
            
            <button 
              onClick={() => (window as any).Telegram?.WebApp?.close()}
              className="w-full h-16 rounded-2xl bg-white/5 border border-white/10 text-white font-black hover:bg-white/10 transition-colors"
            >
              EXIT MINI APP
            </button>
          </div>
        ) : (
          <div className="space-y-6 text-center">
            {/* Referral Stats Header */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="gradient-card rounded-[32px] p-8 text-white relative overflow-hidden"
            >
               <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-20 h-20 rounded-3xl bg-white/10 flex items-center justify-center mb-6 backdrop-blur-xl border border-white/20 shadow-2xl">
                    <Gift className="w-10 h-10 text-white" />
                  </div>
                  <h2 className="text-3xl font-black mb-2 tracking-tight">Invite & Earn</h2>
                  <p className="text-sm opacity-80 max-w-[240px] leading-relaxed mx-auto">
                    Earn <span className="text-white font-bold">50 points</span> for every friend who starts earning with us
                  </p>
                  
                  <div className="grid grid-cols-2 gap-4 w-full mt-10">
                    <div className="bg-black/30 backdrop-blur-md rounded-2xl p-5 border border-white/5 shadow-inner">
                      <p className="text-[10px] uppercase font-black opacity-40 tracking-[0.2em]">Referrals</p>
                      <p className="text-3xl font-black mt-2 leading-none">{profile?.total_invites || 0}</p>
                    </div>
                    <div className="bg-black/30 backdrop-blur-md rounded-2xl p-5 border border-white/5 shadow-inner">
                      <p className="text-[10px] uppercase font-black opacity-40 tracking-[0.2em]">Earnings</p>
                      <p className="text-3xl font-black mt-2 text-[#06B6D4] leading-none">{Math.floor(profile?.referralEarnings || 0)} pts</p>
                    </div>
                  </div>
               </div>

               {/* Modern Decorative Blurs */}
               <div className="absolute -right-16 -top-16 w-48 h-48 bg-[#06B6D4]/30 rounded-full blur-[60px]" />
               <div className="absolute -left-16 -bottom-16 w-48 h-48 bg-[#10B981]/30 rounded-full blur-[60px]" />
            </motion.div>

            {/* Invite Actions Section */}
            <div className="space-y-8 pb-10">
              {/* Copy Link Component */}
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[10px] font-black text-[#A0AEC0] uppercase tracking-[0.15em]">Your Unique Link</label>
                  <span className="text-[10px] text-[#06B6D4] font-bold">Earn 50 points per friend!</span>
                </div>
                <div className="relative group">
                  <input 
                    readOnly 
                    value={referralLink}
                    className="w-full h-16 bg-white/5 border border-white/10 rounded-2xl px-6 text-xs text-white pr-16 focus:outline-none focus:border-[#06B6D4]/50 transition-all font-mono"
                  />
                  <button 
                    onClick={handleCopyLink}
                    className="absolute right-2.5 top-2.5 bottom-2.5 w-11 bg-[#06B6D4] rounded-xl flex items-center justify-center text-white active:scale-95 transition-all shadow-lg shadow-[#06B6D4]/20 hover:bg-[#0891B2]"
                  >
                    <Copy size={18} />
                  </button>
                </div>
              </div>

              {/* Share Strategy Buttons */}
              <div className="grid grid-cols-1 gap-3 text-center">
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleShare}
                  className="w-full h-16 rounded-2xl bg-white text-black font-black flex items-center justify-center gap-4 shadow-[0_10px_30px_rgba(255,255,255,0.1)] hover:bg-[#F3F4F6] transition-colors"
                >
                  <Share2 size={24} />
                  <span>SEND TO FRIENDS</span>
                </motion.button>
              </div>

              {/* Trust/Tutorial Cards */}
              <div className="grid grid-cols-1 gap-4 text-left">
                <div className="stats-card rounded-[24px] p-6 border border-white/5 flex gap-4 items-start">
                   <div className="w-10 h-10 rounded-full bg-[#06B6D4]/10 flex items-center justify-center shrink-0">
                     <CheckCircle2 size={20} className="text-[#06B6D4]" />
                   </div>
                   <div>
                     <h5 className="font-bold text-sm mb-1 text-white">Verified Tracking</h5>
                     <p className="text-xs text-[#A0AEC0] leading-relaxed">
                       Our system verifies every referral instantly using deep-link technology. You get paid 50 points the moment they open the app.
                     </p>
                   </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Navigation Bar */}
      <nav className="fixed bottom-0 left-0 right-0 py-4 pb-8 px-6 nav-blur z-50">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <NavItem icon={<Home />} label="Home" active={activeTab === 'home'} onClick={() => setActiveTab('home')} />
          <NavItem icon={<Zap />} label="Tasks" active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} />
          <NavItem icon={<Users />} label="Invite" active={activeTab === 'invite'} onClick={() => setActiveTab('invite')} />
          <NavItem icon={<Wallet />} label="Wallet" active={activeTab === 'wallet'} onClick={() => setActiveTab('wallet')} />
          <NavItem icon={<UserIcon />} label="Profile" active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} />
        </div>
      </nav>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`flex flex-col items-center gap-1 transition-all group relative ${active ? 'text-[#06B6D4]' : 'text-[#A0AEC0]'}`}
    >
      <div className={`p-2 rounded-xl transition-all ${active ? 'bg-[#06B6D4]/10 scale-110 shadow-lg shadow-[#06B6D4]/10' : 'group-hover:bg-white/5'}`}>
        {React.cloneElement(icon as React.ReactElement, { size: 24, strokeWidth: active ? 2.5 : 2 })}
      </div>
      <span className={`text-[10px] font-bold uppercase tracking-widest ${active ? 'opacity-100' : 'opacity-40'}`}>
        {label}
      </span>
      {active && (
        <motion.div 
          layoutId="nav-pill"
          className="w-1.5 h-1.5 rounded-full bg-[#06B6D4] absolute -bottom-1"
        />
      )}
    </button>
  );
}
