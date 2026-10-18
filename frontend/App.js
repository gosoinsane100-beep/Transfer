import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, ScrollView, ActivityIndicator, Linking, Platform } from 'react-native';

const BACKEND_URL = 'https://transfer-app-df1j.onrender.com';

// Matches the backend's cleanHandle exactly, so "admin-ghana", "Admin Ghana",
// etc. all resolve the same way on both sides.
const cleanHandle = (raw) => (raw || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

// Typing one of these usernames into the regular sign-in form (not sign-up)
// routes to the staff login instead of the customer one — this is the only
// way into the staff dashboard now, there's no separate staff screen.
const RESERVED_ADMIN_HANDLES = ['admin-ghana', 'admin-usa', 'admin-nigeria'].map(cleanHandle);

const PAYMENT_HANDLES = {
  Zelle: 'zelle@yourdomain.com / +1 (555) 019-2831',
  PayPal_FF: 'paypal.me/yourbusiness',
  BinancePay: 'Binance Pay ID: 849201847',
  BybitPay: 'Bybit UID: 92837410',
  // USDT on the Solana network specifically — sending USDT on a different
  // network (Ethereum, Tron, etc.) to this address will not arrive.
  USDT_SOL: 'USDT (Solana network only): GYBEPGBCXsc8Sb1AudHffnVevdfKB38d8RprRtjiC6h3'
};

// Human-readable labels for the raw PAYMENT_HANDLES keys, used everywhere a
// payment method is shown to someone instead of the raw code.
// Per-transfer limits. The server enforces the same numbers, so these only
// exist to tell the customer up front — keep both sides in sync.
const MIN_TRANSFER_USD = 10;
const MAX_TRANSFER_USD = 500;

const PAYMENT_METHOD_LABELS = {
  Zelle: 'Zelle',
  PayPal_FF: 'PayPal (F&F)',
  BinancePay: 'Binance Pay',
  BybitPay: 'Bybit Pay',
  USDT_SOL: 'USDT (Solana)'
};
const paymentMethodLabel = (code) => PAYMENT_METHOD_LABELS[code] || code;

const COUNTRIES = {
  GH: { label: 'Ghana', currency: 'GHS', symbol: '₵', networks: ['MTN', 'Telecel'] },
  NG: { label: 'Nigeria', currency: 'NGN', symbol: '₦', networks: [] }
};

const STATUS_LABELS = {
  pending: 'Pending',
  payment_received: 'Payment received',
  sent: 'Sent',
  completed: 'Completed',
  rejected: 'Rejected'
};

const NEXT_STATUS = { pending: 'payment_received', payment_received: 'sent', sent: 'completed' };
const ADVANCE_LABEL = {
  pending: 'Mark payment received',
  payment_received: 'Mark sent',
  sent: 'Mark completed'
};

export default function App() {
  // Customer auth
  const [user, setUser] = useState(null);
  const [userToken, setUserToken] = useState(null);
  const [isSignUp, setIsSignUp] = useState(false);
  const [username, setUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // Staff session (reached by signing in on the regular screen with one of
  // the reserved regional admin usernames — see RESERVED_ADMIN_HANDLES)
  const [admin, setAdmin] = useState(null);
  const [adminToken, setAdminToken] = useState(null);

  const [activeTab, setActiveTab] = useState('home');

  // Home screen rate preview
  const [previewCountry, setPreviewCountry] = useState('GH');
  const [previewRate, setPreviewRate] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Transfer form state
  const [amountUSD, setAmountUSD] = useState('100');
  const [rate, setRate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [senderName, setSenderName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Zelle');
  const [recipientCountry, setRecipientCountry] = useState('GH');
  const [recipientName, setRecipientName] = useState('');
  const [payoutMethod, setPayoutMethod] = useState('mobile_money');
  const [mobileNetwork, setMobileNetwork] = useState('MTN');
  const [mobileMoneyNumber, setMobileMoneyNumber] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [orderSubmitted, setOrderSubmitted] = useState(false);

  // Customer history
  const [transactions, setTransactions] = useState([]);
  const [fetchingHistory, setFetchingHistory] = useState(false);

  // Customer support
  const [supportMessage, setSupportMessage] = useState('');
  const [submittingSupport, setSubmittingSupport] = useState(false);
  const [myMessages, setMyMessages] = useState([]);
  const [fetchingMyMessages, setFetchingMyMessages] = useState(false);

  // Staff dashboard
  const [adminTransactions, setAdminTransactions] = useState([]);
  const [adminFetching, setAdminFetching] = useState(false);
  const [adminFilter, setAdminFilter] = useState('pending');
  const [payoutRefDrafts, setPayoutRefDrafts] = useState({});
  const [actingOnId, setActingOnId] = useState(null);

  // Staff support inbox
  const [adminView, setAdminView] = useState('transfers'); // 'transfers' | 'support'
  const [supportMessages, setSupportMessages] = useState([]);
  const [supportFetching, setSupportFetching] = useState(false);
  const [supportReplyDrafts, setSupportReplyDrafts] = useState({});
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => {
    if (user && userToken) {
      fetchExchangeRate(recipientCountry);
      fetchUserHistory(userToken);
      fetchMyMessages(userToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userToken]);

  useEffect(() => {
    if (!user) {
      fetchPreviewRate(previewCountry);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCountry, user]);

  useEffect(() => {
    if (admin && adminToken) {
      fetchAdminTransactions();
      fetchSupportMessages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, adminToken]);

  const fetchPreviewRate = async (country) => {
    try {
      setPreviewLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rate?country=${country}`);
      const data = await response.json();
      if (data.success) setPreviewRate(data.rate);
    } catch (err) {
      // leave previous value in place
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCountryChange = (country) => {
    setRecipientCountry(country);
    setPayoutMethod(country === 'GH' ? 'mobile_money' : 'bank_transfer');
    setMobileNetwork(COUNTRIES[country].networks[0] || '');
    setMobileMoneyNumber('');
    setBankName('');
    setBankAccountNumber('');
    fetchExchangeRate(country);
  };

  const handleAuth = async () => {
    if (!username || !authPassword) {
      alert('Enter both a username and a password.');
      return;
    }

    const cleanUsername = cleanHandle(username);
    const isReservedAdminHandle = RESERVED_ADMIN_HANDLES.includes(cleanUsername);

    if (isSignUp && isReservedAdminHandle) {
      alert('That username is reserved for staff sign-in and can\'t be used to create a customer account.');
      return;
    }

    setAuthLoading(true);
    try {
      // A regional admin username (admin-ghana / admin-usa / admin-nigeria)
      // on the sign-in form routes to the staff login instead of the
      // customer one — same screen, no separate staff entry point.
      if (!isSignUp && isReservedAdminHandle) {
        const response = await fetch(`${BACKEND_URL}/api/admin/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password: authPassword })
        });
        const data = await response.json();
        if (data.success) {
          setAdmin(data.admin);
          setAdminToken(data.token);
        } else {
          alert(data.error || 'Could not sign you in.');
        }
        return;
      }

      const endpoint = isSignUp ? '/api/register' : '/api/login';
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: authPassword })
      });
      const data = await response.json();
      if (data.success) {
        setUser(data.user);
        setUserToken(data.token);
      } else {
        alert(data.error || 'Could not sign you in.');
      }
    } catch (err) {
      alert('Could not reach the server.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setUserToken(null);
    setUsername('');
    setAuthPassword('');
    setOrderSubmitted(false);
    setMyMessages([]);
    setSupportMessage('');
  };

  const handleStaffLogout = () => {
    setAdmin(null);
    setAdminToken(null);
    setUsername('');
    setAuthPassword('');
    setAdminTransactions([]);
    setSupportMessages([]);
    setAdminView('transfers');
  };

  const fetchExchangeRate = async (country) => {
    try {
      setLoading(true);
      const response = await fetch(`${BACKEND_URL}/api/rate?country=${country}`);
      const data = await response.json();
      if (data.success) setRate(data.rate);
    } catch (error) {
      // keep whatever rate we already had
    } finally {
      setLoading(false);
    }
  };

  const fetchUserHistory = async (token) => {
    try {
      setFetchingHistory(true);
      const response = await fetch(`${BACKEND_URL}/api/transactions/mine`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) setTransactions(data.transactions);
    } catch (error) {
      // leave list as-is
    } finally {
      setFetchingHistory(false);
    }
  };

  const fetchAdminTransactions = async () => {
    try {
      setAdminFetching(true);
      const response = await fetch(`${BACKEND_URL}/api/admin/transactions`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setAdminTransactions(data.transactions);
      } else if (response.status === 401 || response.status === 403) {
        handleStaffLogout();
      }
    } catch (error) {
      // leave list as-is
    } finally {
      setAdminFetching(false);
    }
  };

  const fetchMyMessages = async (token) => {
    try {
      setFetchingMyMessages(true);
      const response = await fetch(`${BACKEND_URL}/api/support/mine`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.success) setMyMessages(data.messages);
    } catch (error) {
      // leave list as-is
    } finally {
      setFetchingMyMessages(false);
    }
  };

  const handleSubmitSupport = async () => {
    if (!supportMessage.trim()) {
      alert('Write a message first.');
      return;
    }
    setSubmittingSupport(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/support`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({ message: supportMessage })
      });
      const data = await response.json();
      if (data.success) {
        setSupportMessage('');
        fetchMyMessages(userToken);
      } else {
        alert(data.error || 'Could not send that message.');
      }
    } catch (err) {
      alert('Could not reach the server.');
    } finally {
      setSubmittingSupport(false);
    }
  };

  const fetchSupportMessages = async () => {
    try {
      setSupportFetching(true);
      const response = await fetch(`${BACKEND_URL}/api/admin/support`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (data.success) {
        setSupportMessages(data.messages);
      } else if (response.status === 401 || response.status === 403) {
        handleStaffLogout();
      }
    } catch (error) {
      // leave list as-is
    } finally {
      setSupportFetching(false);
    }
  };

  const handleResolveSupport = async (item) => {
    setResolvingId(item.id);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/support/${item.id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ reply: supportReplyDrafts[item.id] || '' })
      });
      const data = await response.json();
      if (data.success) {
        fetchSupportMessages();
      } else {
        alert(data.error || 'Could not update that message.');
      }
    } catch (err) {
      alert('Could not reach the server.');
    } finally {
      setResolvingId(null);
    }
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setUploadingReceipt(true);
    const formData = new FormData();
    formData.append('receipt', file);
    try {
      const response = await fetch(`${BACKEND_URL}/api/upload`, { method: 'POST', body: formData });
      const data = await response.json();
      if (data.success) {
        setReceiptUrl(data.url);
      } else {
        alert('Could not upload that file: ' + data.error);
      }
    } catch (err) {
      alert('Could not upload the receipt image.');
    } finally {
      setUploadingReceipt(false);
    }
  };

  const statusStyle = (status) => {
    if (status === 'completed') return styles.badgeSuccess;
    if (status === 'rejected') return styles.badgeDanger;
    if (status === 'payment_received' || status === 'sent') return styles.badgeProgress;
    return styles.badgePending;
  };

  const statusLabel = (status) => (STATUS_LABELS[status] ? STATUS_LABELS[status] : STATUS_LABELS.pending);

  const platformFeePercent = 0.05;
  const numUSD = parseFloat(amountUSD ? amountUSD : '0');
  const feeUSD = numUSD * platformFeePercent;
  const usdAfterFee = numUSD - feeUSD;
  const localAmount = rate ? usdAfterFee * rate : null;
  const countryInfo = COUNTRIES[recipientCountry];

  const handleSubmitOrder = async () => {
    const missingRecipientField =
      !recipientName ||
      (payoutMethod === 'mobile_money' && !mobileMoneyNumber) ||
      (payoutMethod === 'bank_transfer' && (!bankName || !bankAccountNumber));

    if (!senderName || missingRecipientField) {
      alert("Fill in your name and the recipient's details before submitting.");
      return;
    }
    if (!Number.isFinite(numUSD) || numUSD < MIN_TRANSFER_USD || numUSD > MAX_TRANSFER_USD) {
      alert(`Transfers must be between $${MIN_TRANSFER_USD} and $${MAX_TRANSFER_USD}.`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${BACKEND_URL}/api/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
        body: JSON.stringify({
          senderName,
          amountUSD: numUSD,
          paymentMethod,
          recipientCountry,
          recipientName,
          payoutMethod,
          mobileNetwork: payoutMethod === 'mobile_money' ? mobileNetwork : undefined,
          mobileMoneyNumber: payoutMethod === 'mobile_money' ? mobileMoneyNumber : undefined,
          bankName: payoutMethod === 'bank_transfer' ? bankName : undefined,
          bankAccountNumber: payoutMethod === 'bank_transfer' ? bankAccountNumber : undefined,
          receiptUrl
        })
      });
      const data = await response.json();
      if (data.success) {
        setOrderSubmitted(true);
        fetchUserHistory(userToken);
      } else {
        alert('Could not submit that transfer: ' + data.error);
      }
    } catch (err) {
      alert('Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvanceStatus = async (item) => {
    const next = NEXT_STATUS[item.status];
    if (!next) return;
    if (next === 'sent' && !(payoutRefDrafts[item.id] || '').trim()) {
      alert('Enter a payout reference before marking this as sent.');
      return;
    }
    setActingOnId(item.id);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/transactions/${item.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: next, payoutReference: payoutRefDrafts[item.id] })
      });
      const data = await response.json();
      if (data.success) {
        fetchAdminTransactions();
      } else {
        alert(data.error || 'Could not update that transfer.');
      }
    } catch (err) {
      alert('Could not reach the server.');
    } finally {
      setActingOnId(null);
    }
  };

  const handleReject = async (item) => {
    setActingOnId(item.id);
    try {
      const response = await fetch(`${BACKEND_URL}/api/admin/transactions/${item.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: 'rejected' })
      });
      const data = await response.json();
      if (data.success) {
        fetchAdminTransactions();
      } else {
        alert(data.error || 'Could not update that transfer.');
      }
    } catch (err) {
      alert('Could not reach the server.');
    } finally {
      setActingOnId(null);
    }
  };

  const recipientLine = (item) => {
    if (item.payout_method === 'mobile_money') {
      return `${item.mobile_network || ''} ${item.mobile_money_number || ''}`.trim();
    }
    if (item.payout_method === 'bank_transfer') {
      return `${item.bank_name || ''} · ${item.bank_account_number || ''}`;
    }
    return '—';
  };

  const openSupportCount = supportMessages.filter((m) => m.status === 'open').length;

  const adminFilteredTransactions = adminTransactions.filter((item) => {
    if (adminFilter === 'all') return true;
    if (adminFilter === 'in_progress') return item.status === 'payment_received' || item.status === 'sent';
    return item.status === adminFilter;
  });

  // ---------------------------------------------------------------
  // Staff dashboard — reached by signing in above with a reserved
  // regional admin username (handleAuth routes it to /api/admin/login)
  // ---------------------------------------------------------------
  if (admin) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBarDark}>
          <View>
            <Text style={styles.brandTitle}>CediPay staff</Text>
            <Text style={styles.userSubText}>Signed in as {admin.displayName || admin.username}</Text>
          </View>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleStaffLogout}>
            <Text style={styles.logoutBtnText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity style={[styles.filterChip, adminView === 'transfers' && styles.filterChipActive]} onPress={() => setAdminView('transfers')}>
            <Text style={[styles.filterChipText, adminView === 'transfers' && styles.filterChipTextActive]}>Transfers</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.filterChip, adminView === 'support' && styles.filterChipActive]} onPress={() => setAdminView('support')}>
            <Text style={[styles.filterChipText, adminView === 'support' && styles.filterChipTextActive]}>
              Support{openSupportCount > 0 ? ` (${openSupportCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        {adminView === 'transfers' && (
          <View style={styles.filterRow}>
            {['pending', 'in_progress', 'completed', 'rejected', 'all'].map((f) => (
              <TouchableOpacity key={f} style={[styles.filterChip, adminFilter === f && styles.filterChipActive]} onPress={() => setAdminFilter(f)}>
                <Text style={[styles.filterChipText, adminFilter === f && styles.filterChipTextActive]}>
                  {f === 'in_progress' ? 'In progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {adminView === 'support' && (
          <ScrollView contentContainerStyle={styles.scroll}>
            {supportFetching ? (
              <ActivityIndicator size="large" color="#0F4C3A" style={{ marginVertical: 20 }} />
            ) : supportMessages.length === 0 ? (
              <Text style={styles.emptyText}>No support messages.</Text>
            ) : (
              supportMessages.map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyTitle}>Message #{item.id}</Text>
                    <Text style={[styles.badge, item.status === 'resolved' ? styles.badgeSuccess : styles.badgePending]}>
                      {item.status === 'resolved' ? 'Resolved' : 'Open'}
                    </Text>
                  </View>
                  <Text style={styles.historyDetail}>{item.sender_email}</Text>
                  <Text style={styles.messageBody}>{item.message}</Text>
                  {item.staff_reply ? <Text style={styles.historyDetail}>Reply ({item.resolved_by}): {item.staff_reply}</Text> : null}

                  {item.status === 'open' && (
                    <>
                      <TextInput
                        style={styles.inputMargin}
                        placeholder="Reply to the customer (optional)"
                        multiline
                        value={supportReplyDrafts[item.id] || ''}
                        onChangeText={(val) => setSupportReplyDrafts((prev) => ({ ...prev, [item.id]: val }))}
                      />
                      <TouchableOpacity style={styles.adminActionBtn} onPress={() => handleResolveSupport(item)} disabled={resolvingId === item.id}>
                        {resolvingId === item.id ? <ActivityIndicator color="#FAFBF7" /> : <Text style={styles.buttonText}>Mark resolved</Text>}
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              ))
            )}
          </ScrollView>
        )}

        {adminView === 'transfers' && (
        <ScrollView contentContainerStyle={styles.scroll}>
          {adminFetching ? (
            <ActivityIndicator size="large" color="#0F4C3A" style={{ marginVertical: 20 }} />
          ) : adminFilteredTransactions.length === 0 ? (
            <Text style={styles.emptyText}>Nothing here.</Text>
          ) : (
            adminFilteredTransactions.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>Transfer #{item.id}</Text>
                  <Text style={[styles.badge, statusStyle(item.status)]}>{statusLabel(item.status)}</Text>
                </View>
                <Text style={styles.historyDetail}>{item.sender_name} · {item.sender_email}</Text>
                <Text style={styles.historyDetail}>${item.amount_usd} via {paymentMethodLabel(item.payment_method)}</Text>
                <Text style={styles.historyHighlight}>
                  To {item.recipient_name} — {COUNTRIES[item.recipient_country] ? COUNTRIES[item.recipient_country].symbol : ''}{item.amount_local ? Number(item.amount_local).toLocaleString() : '—'} {item.local_currency}
                </Text>
                <Text style={styles.historyDetail}>{recipientLine(item)}</Text>
                {item.payout_reference ? <Text style={styles.historyDetail}>Payout ref: {item.payout_reference}</Text> : null}
                {item.receipt_url ? (
                  <TouchableOpacity onPress={() => Linking.openURL(item.receipt_url)} style={styles.receiptLink}>
                    <Text style={styles.receiptLinkText}>View payment proof</Text>
                  </TouchableOpacity>
                ) : null}

                {item.status === 'payment_received' && (
                  <TextInput
                    style={styles.inputMargin}
                    placeholder="Payout reference (required to mark sent)"
                    value={payoutRefDrafts[item.id] || ''}
                    onChangeText={(val) => setPayoutRefDrafts((prev) => ({ ...prev, [item.id]: val }))}
                  />
                )}

                {NEXT_STATUS[item.status] && (
                  <TouchableOpacity style={styles.adminActionBtn} onPress={() => handleAdvanceStatus(item)} disabled={actingOnId === item.id}>
                    {actingOnId === item.id ? <ActivityIndicator color="#FAFBF7" /> : <Text style={styles.buttonText}>{ADVANCE_LABEL[item.status]}</Text>}
                  </TouchableOpacity>
                )}
                {item.status !== 'completed' && item.status !== 'rejected' && (
                  <TouchableOpacity style={styles.adminRejectBtn} onPress={() => handleReject(item)} disabled={actingOnId === item.id}>
                    <Text style={styles.adminRejectText}>Reject</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </ScrollView>
        )}
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------
  // Customer sign-in / sign-up
  // ---------------------------------------------------------------
  if (!user) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.topBarDark}>
          <Text style={styles.brandTitle}>CediPay</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scrollCenter}>
          <View style={styles.authCard}>
            <Text style={styles.title}>{isSignUp ? 'Create your account' : 'Sign in'}</Text>

            <Text style={styles.label}>Username</Text>
            <TextInput style={styles.inputMargin} autoCapitalize="none" value={username} onChangeText={setUsername} placeholder="e.g. ama123" />

            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.inputMargin} secureTextEntry value={authPassword} onChangeText={setAuthPassword} placeholder="••••••••" />

            <TouchableOpacity style={styles.button} onPress={handleAuth} disabled={authLoading}>
              {authLoading ? <ActivityIndicator color="#FAFBF7" /> : <Text style={styles.buttonText}>{isSignUp ? 'Create account' : 'Sign in'}</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={styles.switchAuthBtn} onPress={() => setIsSignUp(!isSignUp)}>
              <Text style={styles.switchAuthText}>{isSignUp ? 'Already have an account? Sign in' : 'New here? Create an account'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------------------
  // Customer app
  // ---------------------------------------------------------------
  const userDisplayName = user.username ? user.username : 'there';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBarDark}>
        <View>
          <Text style={styles.brandTitle}>CediPay</Text>
          <Text style={styles.userSubText}>@{userDisplayName}</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {activeTab === 'home' && (
          <View style={styles.screenContainer}>
            <Text style={styles.greetingText}>Welcome back, @{userDisplayName}</Text>

            <View style={styles.rateCard}>
              <View style={styles.rateCardTop}>
                <Text style={styles.rateCardTitle}>Exchange rate</Text>
                <View style={styles.countryToggleRow}>
                  {Object.keys(COUNTRIES).map((code) => (
                    <TouchableOpacity key={code} style={[styles.countryPill, previewCountry === code && styles.countryPillActive]} onPress={() => setPreviewCountry(code)}>
                      <Text style={[styles.countryPillText, previewCountry === code && styles.countryPillTextActive]}>{code}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={styles.rateRow}>
                <Text style={styles.currencySymbol}>{COUNTRIES[previewCountry].symbol}</Text>
                <Text style={styles.rateHighlight}>
                  {previewLoading || previewRate === null ? '···' : previewRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </Text>
              </View>
              <Text style={styles.rateCardSub}>per 1 USD, to {COUNTRIES[previewCountry].label}</Text>
            </View>

            <View style={styles.bannerCard}>
              <Text style={styles.bannerTitle}>Send money home</Text>
              <Text style={styles.bannerDesc}>Send USD from the US — your family receives mobile money or a bank transfer in Ghana or Nigeria, usually within a day.</Text>
              <TouchableOpacity style={styles.bannerBtn} onPress={() => setActiveTab('send')}>
                <Text style={styles.bannerBtnText}>Send money</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Recent activity</Text>
            {transactions.length === 0 ? (
              <Text style={styles.emptyText}>No transfers yet.</Text>
            ) : (
              transactions.slice(0, 3).map((item) => (
                <View key={item.id} style={styles.miniCard}>
                  <View>
                    <Text style={styles.miniCardTitle}>To {item.recipient_name}</Text>
                    <Text style={styles.miniCardSub}>${item.amount_usd} USD ({paymentMethodLabel(item.payment_method)})</Text>
                  </View>
                  <Text style={[styles.miniStatus, statusStyle(item.status)]}>{statusLabel(item.status)}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'send' && (
          <View style={styles.screenContainer}>
            <Text style={styles.title}>New transfer</Text>
            <Text style={styles.subtitle}>Send USD, your family receives local currency</Text>

            {orderSubmitted ? (
              <View style={styles.successContainer}>
                <Text style={styles.successTitle}>Transfer submitted</Text>
                <Text style={styles.successText}>
                  Send ${numUSD} via {paymentMethodLabel(paymentMethod)}. Once it's confirmed, {countryInfo.symbol}{localAmount ? localAmount.toLocaleString() : '—'} will go out to {recipientName}.
                </Text>
                <TouchableOpacity style={styles.button} onPress={() => { setOrderSubmitted(false); setActiveTab('history'); }}>
                  <Text style={styles.buttonText}>View in history</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.sectionHeader}>Sending to</Text>
                <View style={styles.railRow}>
                  {Object.keys(COUNTRIES).map((code) => (
                    <TouchableOpacity key={code} style={[styles.railButton, recipientCountry === code && styles.railButtonActive]} onPress={() => handleCountryChange(code)}>
                      <Text style={[styles.railText, recipientCountry === code && styles.railTextActive]}>{COUNTRIES[code].label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.inputContainer}>
                  <Text style={styles.label}>You send</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={amountUSD} onChangeText={setAmountUSD} />
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>Limits: ${MIN_TRANSFER_USD} – ${MAX_TRANSFER_USD} per transfer</Text>
                  <Text style={styles.infoText}>Fee (5%): ${feeUSD.toFixed(2)}</Text>
                  <Text style={styles.infoText}>Rate: $1 = {loading || rate === null ? '···' : rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} {countryInfo.currency}</Text>
                </View>

                <View style={styles.resultContainer}>
                  <Text style={styles.resultLabel}>They receive</Text>
                  <Text style={styles.resultValue}>{countryInfo.symbol}{localAmount ? localAmount.toLocaleString() : '—'}</Text>
                </View>

                <Text style={styles.sectionHeader}>Your details</Text>
                <TextInput style={styles.inputMargin} placeholder="Full name" value={senderName} onChangeText={setSenderName} />

                <Text style={styles.sectionHeader}>How you're paying</Text>
                <View style={styles.railRow}>
                  {['Zelle', 'PayPal_FF', 'BinancePay', 'BybitPay', 'USDT_SOL'].map((method) => (
                    <TouchableOpacity key={method} style={[styles.railButton, paymentMethod === method && styles.railButtonActive]} onPress={() => setPaymentMethod(method)}>
                      <Text style={[styles.railText, paymentMethod === method && styles.railTextActive]}>{paymentMethodLabel(method)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.handleBox}>
                  <Text style={styles.handleLabel}>Send the exact amount to:</Text>
                  <Text style={styles.handleText}>{PAYMENT_HANDLES[paymentMethod]}</Text>
                </View>

                <Text style={styles.sectionHeader}>Payment proof</Text>
                <View style={styles.uploadContainer}>
                  <input type="file" accept="image/*" onChange={handleFileChange} style={{ marginBottom: 8 }} />
                  {uploadingReceipt && <Text style={styles.uploadingText}>Uploading…</Text>}
                  {receiptUrl ? <Text style={styles.uploadedText}>Receipt attached</Text> : null}
                </View>

                <Text style={styles.sectionHeader}>Recipient details</Text>
                <TextInput style={styles.inputMargin} placeholder="Recipient full name" value={recipientName} onChangeText={setRecipientName} />

                <Text style={styles.sectionHeader}>How they'll receive it</Text>
                <View style={styles.railRow}>
                  {countryInfo.networks.length > 0 && (
                    <TouchableOpacity style={[styles.railButton, payoutMethod === 'mobile_money' && styles.railButtonActive]} onPress={() => setPayoutMethod('mobile_money')}>
                      <Text style={[styles.railText, payoutMethod === 'mobile_money' && styles.railTextActive]}>Mobile money</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[styles.railButton, payoutMethod === 'bank_transfer' && styles.railButtonActive]} onPress={() => setPayoutMethod('bank_transfer')}>
                    <Text style={[styles.railText, payoutMethod === 'bank_transfer' && styles.railTextActive]}>Bank transfer</Text>
                  </TouchableOpacity>
                </View>

                {payoutMethod === 'mobile_money' && countryInfo.networks.length > 0 && (
                  <>
                    <View style={styles.railRow}>
                      {countryInfo.networks.map((net) => (
                        <TouchableOpacity key={net} style={[styles.railButton, mobileNetwork === net && styles.railButtonActive]} onPress={() => setMobileNetwork(net)}>
                          <Text style={[styles.railText, mobileNetwork === net && styles.railTextActive]}>{net}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput style={styles.inputMargin} placeholder="Mobile money number" keyboardType="phone-pad" value={mobileMoneyNumber} onChangeText={setMobileMoneyNumber} />
                  </>
                )}

                {payoutMethod === 'bank_transfer' && (
                  <>
                    <TextInput style={styles.inputMargin} placeholder="Bank name" value={bankName} onChangeText={setBankName} />
                    <TextInput style={styles.inputMargin} placeholder="Account number" keyboardType="numeric" value={bankAccountNumber} onChangeText={setBankAccountNumber} />
                  </>
                )}

                <TouchableOpacity style={styles.button} onPress={handleSubmitOrder} disabled={submitting}>
                  {submitting ? <ActivityIndicator color="#FAFBF7" /> : <Text style={styles.buttonText}>Submit transfer</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {activeTab === 'history' && (
          <View style={styles.screenContainer}>
            <Text style={styles.title}>Your transfers</Text>
            <Text style={styles.subtitle}>Track each transfer's status</Text>

            {fetchingHistory ? (
              <ActivityIndicator size="large" color="#0F4C3A" style={{ marginVertical: 20 }} />
            ) : transactions.length === 0 ? (
              <Text style={styles.emptyText}>No transfers yet.</Text>
            ) : (
              transactions.map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyTitle}>Transfer #{item.id}</Text>
                    <Text style={[styles.badge, statusStyle(item.status)]}>{statusLabel(item.status)}</Text>
                  </View>
                  <Text style={styles.historyDetail}>Paid: ${item.amount_usd} USD via {paymentMethodLabel(item.payment_method)}</Text>
                  <Text style={styles.historyHighlight}>
                    Payout: {COUNTRIES[item.recipient_country] ? COUNTRIES[item.recipient_country].symbol : ''}{item.amount_local ? Number(item.amount_local).toLocaleString() : '—'} {item.local_currency}
                  </Text>
                  <Text style={styles.historyDetail}>To: {item.recipient_name} — {recipientLine(item)}</Text>

                  {item.receipt_url ? (
                    <TouchableOpacity onPress={() => Linking.openURL(item.receipt_url)} style={styles.receiptLink}>
                      <Text style={styles.receiptLinkText}>View attached receipt</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'support' && (
          <View style={styles.screenContainer}>
            <Text style={styles.title}>Support</Text>
            <Text style={styles.subtitle}>Ask us anything about a transfer — our team will reply here</Text>

            <TextInput
              style={[styles.inputMargin, styles.messageInput]}
              placeholder="Write your message (include the transfer number if it's about a specific one)"
              multiline
              maxLength={2000}
              value={supportMessage}
              onChangeText={setSupportMessage}
            />
            <TouchableOpacity style={styles.button} onPress={handleSubmitSupport} disabled={submittingSupport}>
              {submittingSupport ? <ActivityIndicator color="#FAFBF7" /> : <Text style={styles.buttonText}>Send message</Text>}
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>Your messages</Text>
            {fetchingMyMessages ? (
              <ActivityIndicator size="large" color="#0F4C3A" style={{ marginVertical: 20 }} />
            ) : myMessages.length === 0 ? (
              <Text style={styles.emptyText}>No messages yet.</Text>
            ) : (
              myMessages.map((item) => (
                <View key={item.id} style={styles.historyCard}>
                  <View style={styles.historyHeader}>
                    <Text style={styles.historyTitle}>Message #{item.id}</Text>
                    <Text style={[styles.badge, item.status === 'resolved' ? styles.badgeSuccess : styles.badgePending]}>
                      {item.status === 'resolved' ? 'Resolved' : 'Open'}
                    </Text>
                  </View>
                  <Text style={styles.messageBody}>{item.message}</Text>
                  {item.staff_reply ? <Text style={styles.historyHighlight}>Reply: {item.staff_reply}</Text> : null}
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomNav}>
        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
          <Text style={styles.navIcon}>⌂</Text>
          <Text style={[styles.navText, activeTab === 'home' && styles.navTextActive]}>Home</Text>
          {activeTab === 'home' ? <View style={styles.navActiveMark} /> : null}
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('send')}>
          <Text style={styles.navIcon}>↗</Text>
          <Text style={[styles.navText, activeTab === 'send' && styles.navTextActive]}>Send</Text>
          {activeTab === 'send' ? <View style={styles.navActiveMark} /> : null}
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('history')}>
          <Text style={styles.navIcon}>☰</Text>
          <Text style={[styles.navText, activeTab === 'history' && styles.navTextActive]}>History</Text>
          {activeTab === 'history' ? <View style={styles.navActiveMark} /> : null}
        </TouchableOpacity>

        <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('support')}>
          <Text style={styles.navIcon}>✉</Text>
          <Text style={[styles.navText, activeTab === 'support' && styles.navTextActive]}>Support</Text>
          {activeTab === 'support' ? <View style={styles.navActiveMark} /> : null}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ---- Visual tokens -------------------------------------------------
// CediPay's identity: a light, warm-neutral surface rather than a dark
// "legacy bank" shell, a single deep teal used for structural dark
// surfaces (top bar, the rate panel, primary buttons), and one vivid
// marigold spent only on the numbers that represent money — the rate,
// the payout amount, the currency symbol. The currency symbol (₵ or ₦)
// sits directly in the rate display because the app spans two
// currencies now; it's information, not decoration. Flat hairline-bordered
// cards, no shadows, bold numerals instead of a display serif.
const colors = {
  ink: '#16231F',
  paper: '#FAFBF7',
  card: '#FFFFFF',
  border: '#DCE5DE',
  muted: '#5C6B64',
  surface: '#0F4C3A',
  surfacePressed: '#0A3A2C',
  gold: '#E3A530',
  goldSoft: '#FBEACB',
  pendingBg: '#FBEACB',
  pendingText: '#8A5A10',
  progressBg: '#DDEAE4',
  progressText: '#0F4C3A',
  successBg: '#DCF0E4',
  successText: '#146241',
  dangerBg: '#F7E0DC',
  dangerText: '#9A3B2E'
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  topBarDark: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: colors.surface },
  brandTitle: { fontSize: 19, fontWeight: '800', color: colors.paper, letterSpacing: 0.2 },
  userSubText: { fontSize: 12, color: colors.gold, marginTop: 2 },
  logoutBtn: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(250,251,247,0.35)' },
  logoutBtnText: { fontSize: 12, fontWeight: '600', color: colors.paper },
  scroll: { padding: 16, paddingBottom: 96 },
  scrollCenter: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  authCard: { backgroundColor: colors.card, borderRadius: 14, padding: 22, borderWidth: 1, borderColor: colors.border },
  switchAuthBtn: { marginTop: 14, alignItems: 'center' },
  switchAuthText: { fontSize: 13, color: colors.surface, fontWeight: '600' },
  backLinkText: { fontSize: 12, color: colors.muted, fontWeight: '600' },
  screenContainer: { flex: 1 },
  greetingText: { fontSize: 19, fontWeight: '700', color: colors.ink, marginBottom: 14 },

  rateCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 18, marginBottom: 16 },
  rateCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rateCardTitle: { fontSize: 12, color: 'rgba(250,251,247,0.7)', letterSpacing: 0.2 },
  countryToggleRow: { flexDirection: 'row', gap: 6 },
  countryPill: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(250,251,247,0.35)' },
  countryPillActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  countryPillText: { fontSize: 11, fontWeight: '700', color: 'rgba(250,251,247,0.8)' },
  countryPillTextActive: { color: colors.surface },
  rateRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 10 },
  currencySymbol: { fontSize: 24, fontWeight: '800', color: colors.gold, marginRight: 6, marginBottom: 2 },
  rateHighlight: { fontSize: 34, fontWeight: '800', color: colors.gold, letterSpacing: -0.5 },
  rateCardSub: { fontSize: 12, color: 'rgba(250,251,247,0.65)', marginTop: 4 },

  bannerCard: { backgroundColor: colors.card, borderRadius: 14, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: colors.border },
  bannerTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  bannerDesc: { fontSize: 13, color: colors.muted, marginTop: 4, marginBottom: 14, lineHeight: 19 },
  bannerBtn: { backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, alignSelf: 'flex-start' },
  bannerBtnText: { fontSize: 13, fontWeight: '700', color: colors.paper },

  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.ink, marginBottom: 10 },
  emptyText: { fontSize: 13, color: colors.muted, fontStyle: 'italic', marginVertical: 10 },
  miniCard: { backgroundColor: colors.card, padding: 12, borderRadius: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  miniCardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  miniCardSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  miniStatus: { fontSize: 11, fontWeight: '700', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 20, overflow: 'hidden' },

  title: { fontSize: 20, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 6 },
  subtitle: { fontSize: 13, color: colors.muted, textAlign: 'center', marginBottom: 18 },
  inputContainer: { marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: colors.ink, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 18, backgroundColor: colors.card, color: colors.ink },
  inputMargin: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, fontSize: 14, marginBottom: 10, backgroundColor: colors.card, color: colors.ink },
  infoBox: { backgroundColor: colors.card, padding: 10, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  infoText: { fontSize: 13, color: colors.muted, marginVertical: 2 },
  resultContainer: { alignItems: 'center', marginVertical: 12, padding: 18, backgroundColor: colors.surface, borderRadius: 14 },
  resultLabel: { fontSize: 12, color: 'rgba(250,251,247,0.7)' },
  resultValue: { fontSize: 28, fontWeight: '800', color: colors.gold, marginTop: 4, letterSpacing: -0.5 },
  sectionHeader: { fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 10, marginBottom: 8 },
  railRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  railButton: { paddingVertical: 8, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  railButtonActive: { backgroundColor: colors.surface, borderColor: colors.surface },
  railText: { fontSize: 12, color: colors.ink, fontWeight: '600' },
  railTextActive: { color: colors.paper },
  handleBox: { backgroundColor: colors.card, padding: 10, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  handleLabel: { fontSize: 11, color: colors.muted },
  handleText: { fontSize: 14, color: colors.ink, fontWeight: '600', marginTop: 2 },
  uploadContainer: { marginBottom: 12, padding: 10, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  uploadingText: { fontSize: 12, color: colors.surface },
  uploadedText: { fontSize: 13, color: colors.successText, fontWeight: '600' },
  button: { backgroundColor: colors.surface, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  buttonText: { color: colors.paper, fontSize: 15, fontWeight: '700' },
  successContainer: { padding: 16, alignItems: 'center' },
  successTitle: { fontSize: 18, fontWeight: '800', color: colors.successText, marginBottom: 8 },
  successText: { fontSize: 14, color: colors.ink, textAlign: 'center', lineHeight: 20, marginBottom: 16 },

  historyCard: { backgroundColor: colors.card, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  historyTitle: { fontSize: 15, fontWeight: '700', color: colors.ink },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 20, fontSize: 11, fontWeight: '700', overflow: 'hidden' },
  badgePending: { backgroundColor: colors.pendingBg, color: colors.pendingText },
  badgeSuccess: { backgroundColor: colors.successBg, color: colors.successText },
  badgeDanger: { backgroundColor: colors.dangerBg, color: colors.dangerText },
  badgeProgress: { backgroundColor: colors.progressBg, color: colors.progressText },
  historyDetail: { fontSize: 12, color: colors.muted, marginBottom: 2 },
  historyHighlight: { fontSize: 14, fontWeight: '700', color: colors.successText, marginVertical: 2 },
  messageBody: { fontSize: 14, color: colors.ink, lineHeight: 20, marginVertical: 4 },
  messageInput: { minHeight: 110, textAlignVertical: 'top' },
  receiptLink: { marginTop: 6 },
  receiptLinkText: { fontSize: 12, color: colors.surface, fontWeight: '600' },

  adminActionBtn: { backgroundColor: colors.surface, paddingVertical: 10, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  adminRejectBtn: { paddingVertical: 10, borderRadius: 10, alignItems: 'center', marginTop: 8, borderWidth: 1, borderColor: colors.dangerText },
  adminRejectText: { color: colors.dangerText, fontSize: 13, fontWeight: '700' },

  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, backgroundColor: colors.paper },
  filterChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  filterChipActive: { backgroundColor: colors.surface, borderColor: colors.surface },
  filterChipText: { fontSize: 12, fontWeight: '600', color: colors.ink },
  filterChipTextActive: { color: colors.paper },

  bottomNav: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 66, backgroundColor: colors.card, flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, justifyContent: 'space-around', alignItems: 'center' },
  navItem: { alignItems: 'center', justifyContent: 'center', paddingTop: 4 },
  navIcon: { fontSize: 18, color: colors.muted },
  navText: { fontSize: 11, color: colors.muted, marginTop: 2 },
  navTextActive: { color: colors.surface, fontWeight: '700' },
  navActiveMark: { width: 16, height: 2, backgroundColor: colors.surface, borderRadius: 1, marginTop: 4 }
});
