import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  FileCheck2,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { apiRequest } from './lib/api.ts';
import { formatDateTime } from './lib/utils.ts';
import { LandingPage } from './components/LandingPage.tsx';
import { AuthView } from './components/AuthView.tsx';
import { OnboardingView } from './components/OnboardingView.tsx';
import { OverviewPage } from './components/OverviewPage.tsx';
import { MandatesPage } from './components/MandatesPage.tsx';
import { PaymentVerificationPage } from './components/PaymentVerificationPage.tsx';
import { ConsentDriftReplayPage } from './components/ConsentDriftReplayPage.tsx';
import { InvestigationsPage } from './components/InvestigationsPage.tsx';
import { ReportsPage } from './components/ReportsPage.tsx';
import { SettingsPage } from './components/SettingsPage.tsx';
import { DemoMarker } from './components/ui/Primitives.tsx';

type NavTab =
  | 'overview'
  | 'mandates'
  | 'verification'
  | 'replay'
  | 'investigations'
  | 'reports'
  | 'settings';

const NAV_ITEMS: Array<{
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'mandates', label: 'Mandates', icon: FileText },
  { id: 'verification', label: 'Payment Verification', icon: FileCheck2 },
  { id: 'replay', label: 'Consent Drift Replay', icon: History },
  { id: 'investigations', label: 'Investigations', icon: Briefcase },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: Settings },
];

function AuthenticatedShell() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [showOnboarding, setShowOnboarding] = useState(!user?.onboardingCompleted);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Cross-tab context state
  const [mandateModalIntent, setMandateModalIntent] = useState<'create' | 'upload' | null>(null);
  const [replayContext, setReplayContext] = useState<{
    mandateId: number | null;
    paymentAttemptId: number | null;
  }>({ mandateId: null, paymentAttemptId: null });
  const [caseContextId, setCaseContextId] = useState<number | null>(null);

  // Top bar: Global Search, Notifications, Account Menu
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiRequest<{ notifications: any[] }>('/api/notifications');
      setNotifications(res.notifications);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications, activeTab]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await apiRequest(
          `/api/search?q=${encodeURIComponent(searchQuery.trim())}`
        );
        setSearchResults(res);
        setSearchOpen(true);
      } catch {
        // ignore
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const openReplay = (mandateId: number, paymentAttemptId?: number) => {
    setReplayContext({ mandateId, paymentAttemptId: paymentAttemptId ?? null });
    setShowOnboarding(false);
    setActiveTab('replay');
    setSearchOpen(false);
    setNotifOpen(false);
  };

  const openInvestigation = (caseId: number) => {
    setCaseContextId(caseId);
    setShowOnboarding(false);
    setActiveTab('investigations');
    setSearchOpen(false);
    setNotifOpen(false);
  };

  const activeNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label ?? 'Overview';

  return (
    <div className="min-h-screen bg-slate-50/70 text-slate-900 flex">
      {/* Desktop Collapsible Sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-white border-r border-slate-200 transition-all duration-150 shrink-0 ${
          sidebarCollapsed ? 'w-[70px]' : 'w-60'
        }`}
      >
        <div className="h-16 px-4 border-b border-slate-200 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              setShowOnboarding(false);
              setActiveTab('overview');
            }}
            className="flex items-center gap-2.5 text-base font-bold tracking-tight text-slate-900 overflow-hidden cursor-pointer"
          >
            <span className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </span>
            {!sidebarCollapsed && <span className="whitespace-nowrap">DebitOrigin</span>}
          </button>
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md cursor-pointer"
          >
            {sidebarCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = !showOnboarding && activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => {
                  setShowOnboarding(false);
                  setActiveTab(item.id);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200">
          <button
            type="button"
            onClick={logout}
            title={sidebarCollapsed ? 'Logout' : undefined}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {!sidebarCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-64 bg-white border-r border-slate-200 flex flex-col shadow-xl">
            <div className="h-16 px-4 border-b border-slate-200 flex items-center justify-between">
              <span className="flex items-center gap-2 text-base font-bold text-slate-900">
                <span className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center">
                  <ShieldCheck className="w-4 h-4" />
                </span>
                DebitOrigin
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setShowOnboarding(false);
                    setActiveTab(item.id);
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer ${
                    !showOnboarding && activeTab === item.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="p-3 border-t border-slate-200">
              <button
                type="button"
                onClick={logout}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-red-700 hover:bg-red-50 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
          <div
            className="flex-1 bg-slate-900/30"
            onClick={() => setMobileNavOpen(false)}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Compact Top Navigation Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-1.5 text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
              <span>DebitOrigin</span>
              <span>/</span>
              <span className="font-semibold text-slate-900">
                {showOnboarding ? 'Getting Started' : activeNavLabel}
              </span>
            </div>
          </div>

          {/* Global Search */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => searchResults && setSearchOpen(true)}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search mandates, payment attempts, or cases..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
            {searchOpen && searchResults && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg p-3 z-40 max-h-80 overflow-y-auto text-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-500">Search Results</span>
                  <button
                    type="button"
                    onClick={() => setSearchOpen(false)}
                    className="text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    Close
                  </button>
                </div>

                {searchResults.mandates.length === 0 &&
                searchResults.attempts.length === 0 &&
                searchResults.investigations.length === 0 ? (
                  <p className="text-slate-500 py-2">No matching records found.</p>
                ) : (
                  <>
                    {searchResults.mandates.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">
                          Mandates
                        </div>
                        {searchResults.mandates.map((m: any) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => openReplay(m.id)}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 flex justify-between items-center cursor-pointer"
                          >
                            <span className="font-mono font-semibold text-slate-900">
                              {m.mandateCode}
                            </span>
                            <span className="text-slate-500 truncate ml-2">{m.merchantName}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {searchResults.attempts.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">
                          Payment Attempts
                        </div>
                        {searchResults.attempts.map((a: any) => (
                          <button
                            key={a.id}
                            type="button"
                            onClick={() => openReplay(a.mandateId, a.id)}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 flex justify-between items-center cursor-pointer"
                          >
                            <span className="font-mono font-semibold text-slate-900">
                              {a.attemptUid}
                            </span>
                            <span className="text-slate-500 font-mono">
                              {a.currency} {a.attemptedAmount}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {searchResults.investigations.length > 0 && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-400 uppercase mb-1">
                          Investigations
                        </div>
                        {searchResults.investigations.map((c: any) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => openInvestigation(c.id)}
                            className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-50 flex justify-between items-center cursor-pointer"
                          >
                            <span className="font-mono font-semibold text-slate-900">
                              {c.caseUid}
                            </span>
                            <span className="text-slate-500 truncate ml-2">{c.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right Controls: Notifications & User Account Menu */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Notifications */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setAccountMenuOpen(false);
                }}
                aria-label="Notifications"
                className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 px-1 min-w-[16px] h-4 text-[10px] font-mono font-bold bg-blue-700 text-white rounded flex items-center justify-center">
                    {notifications.length}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">Risk Alerts & Open Cases</span>
                    <button
                      type="button"
                      onClick={() => setNotifOpen(false)}
                      className="text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-5 text-center text-xs text-slate-500">
                        No flagged attempts or open cases requiring attention.
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            if (n.targetTab === 'investigations' && n.caseId) {
                              openInvestigation(n.caseId);
                            } else if (n.mandateId) {
                              openReplay(n.mandateId, n.paymentAttemptId);
                            }
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer text-xs"
                        >
                          <div className="font-medium text-slate-900 flex items-center justify-between gap-2">
                            <span className="truncate">{n.title}</span>
                            {n.isDemo && <DemoMarker />}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">{n.subtitle}</div>
                          <div className="text-[10px] font-mono text-slate-400 mt-1">
                            {formatDateTime(n.timestamp)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Profile / Account Menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setAccountMenuOpen((v) => !v);
                  setNotifOpen(false);
                }}
                className="flex items-center gap-2.5 pl-2 pr-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className="w-6 h-6 rounded-md bg-slate-900 text-white text-xs font-semibold flex items-center justify-center">
                  {(user?.fullName || 'U').slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden md:block text-xs font-medium text-slate-800 max-w-[130px] truncate">
                  {user?.fullName}
                </span>
              </button>

              {accountMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-40 py-1.5 text-xs">
                  <div className="px-3.5 py-2.5 border-b border-slate-100">
                    <div className="font-semibold text-slate-900 truncate">{user?.fullName}</div>
                    <div className="text-slate-500 truncate mt-0.5">{user?.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setShowOnboarding(false);
                      setActiveTab('settings');
                    }}
                    className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Account Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAccountMenuOpen(false);
                      setShowOnboarding(true);
                    }}
                    className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Onboarding Guide
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full text-left px-3.5 py-2 text-red-700 hover:bg-red-50 font-medium cursor-pointer"
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 lg:p-7 max-w-[1440px] w-full mx-auto">
          {showOnboarding ? (
            <OnboardingView
              onSelectUpload={() => {
                setShowOnboarding(false);
                setMandateModalIntent('upload');
                setActiveTab('mandates');
              }}
              onSelectManual={() => {
                setShowOnboarding(false);
                setMandateModalIntent('create');
                setActiveTab('mandates');
              }}
              onDemoLoaded={() => {
                setShowOnboarding(false);
                setActiveTab('overview');
              }}
              onSkip={() => {
                setShowOnboarding(false);
                setActiveTab('overview');
              }}
            />
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewPage
                  onNavigate={(t) => setActiveTab(t as NavTab)}
                  onOpenReplay={openReplay}
                  onOpenInvestigation={openInvestigation}
                  onTriggerCreateMandate={() => {
                    setMandateModalIntent('create');
                    setActiveTab('mandates');
                  }}
                  onTriggerUploadDoc={() => {
                    setMandateModalIntent('upload');
                    setActiveTab('mandates');
                  }}
                />
              )}
              {activeTab === 'mandates' && (
                <MandatesPage
                  initialModal={mandateModalIntent}
                  onClearInitialModal={() => setMandateModalIntent(null)}
                  onOpenReplay={(mId) => openReplay(mId)}
                />
              )}
              {activeTab === 'verification' && (
                <PaymentVerificationPage
                  onOpenReplay={openReplay}
                  onOpenInvestigation={openInvestigation}
                />
              )}
              {activeTab === 'replay' && (
                <ConsentDriftReplayPage
                  initialMandateId={replayContext.mandateId}
                  initialAttemptId={replayContext.paymentAttemptId}
                  onOpenInvestigation={openInvestigation}
                  onNavigate={(t) => setActiveTab(t as NavTab)}
                />
              )}
              {activeTab === 'investigations' && (
                <InvestigationsPage
                  initialCaseId={caseContextId}
                  onClearInitialCaseId={() => setCaseContextId(null)}
                  onOpenReplay={openReplay}
                  onNavigate={(t) => setActiveTab(t as NavTab)}
                />
              )}
              {activeTab === 'reports' && <ReportsPage />}
              {activeTab === 'settings' && (
                <SettingsPage onReopenOnboarding={() => setShowOnboarding(true)} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function AppRouter() {
  const { user, loading } = useAuth();
  const [publicScreen, setPublicScreen] = useState<'landing' | 'login' | 'signup'>('landing');

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </span>
          <span className="font-semibold text-slate-900">DebitOrigin</span>
          <span className="text-slate-400">· Loading workspace...</span>
        </div>
      </div>
    );
  }

  if (user) {
    return <AuthenticatedShell />;
  }

  if (publicScreen === 'landing') {
    return (
      <LandingPage
        onGetStarted={() => setPublicScreen('signup')}
        onLogin={() => setPublicScreen('login')}
      />
    );
  }

  return (
    <AuthView
      initialMode={publicScreen === 'signup' ? 'signup' : 'login'}
      onBackToLanding={() => setPublicScreen('landing')}
    />
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}
