import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import API from "../api/axios";
import BlockUserDialog from "../components/BlockUserDialog";
import Avatar from "../components/Avatar";
import { CloseIcon } from "../components/icons";
import { isNetworkFailure } from "../utils/authErrors";
import { BLOCKED_USERS_CHANGED_EVENT, blockUser, isBlockedUser, unblockUser } from "../utils/blockedUsers";
import { setBottomNavCollapsed } from "../utils/bottomNav";
import "../styles/UserSafety.css";
import "../styles/MessagesPage.css";

const QUICK_REACTIONS = ["👍", "😂", "👎"];
const EXTRA_REACTIONS = ["❤️", "🔥", "😮", "😢", "👏", "🎉"];
const REPORT_REASONS = [
  { value: "profanity", label: "Profanity" },
  { value: "inappropriate_message", label: "Inappropriate message" },
  { value: "harassment", label: "Harassment" },
  { value: "spam_or_scam", label: "Spam or scam" },
  { value: "threat_or_abuse", label: "Threat or abuse" },
  { value: "other", label: "Other" },
];

function trimMessagePreview(text, limit = 92) {
  const next = (text || "").trim();
  if (!next) return "";
  return next.length > limit ? `${next.slice(0, limit - 3)}...` : next;
}

function InboxItem({ convo }) {
  const otherUser = convo.other_user || {};
  const handle = otherUser.handle || convo.other_user_handle || convo.handle || convo.user_id;
  const name = otherUser.display_name || convo.other_user_name || `@${handle}`;
  const preview = convo.last_message_preview || convo.last_message || "No messages yet";

  return (
    <Link className="msg-inbox-item" to={`/messages/${convo.user_id}`}>
      <Avatar
        size="sm"
        user={{ ...otherUser, handle, profile_picture_url: convo.other_user_avatar_url }}
      />
      <div className="msg-inbox-meta">
        <div className="msg-inbox-top">
          <strong>{name}</strong>
          {convo.unread_count ? <span className="msg-pill">{convo.unread_count}</span> : null}
        </div>
        <div className="msg-handle">@{handle}</div>
        <div className="msg-muted">{preview}</div>
      </div>
    </Link>
  );
}

function MessageBubble({
  message,
  isActive,
  pickerOpen,
  conversationBlocked,
  onActivate,
  onDeactivate,
  onReply,
  onReact,
  onTogglePicker,
  onReport,
  onBlockToggle,
}) {
  const outgoing = Boolean(message.is_from_me);

  return (
    <div
      className={`msg-row ${outgoing ? "outgoing" : "incoming"} ${isActive ? "active" : ""}`.trim()}
      onMouseEnter={() => onActivate(message.message_id)}
      onMouseLeave={() => onDeactivate(message.message_id)}
    >
      <div className={`msg-bubble ${outgoing ? "outgoing" : "incoming"}`}>
        {message.reply_preview ? (
          <div className="msg-reply-preview">
            <strong>{message.reply_preview.sender_name || "Reply"}</strong>
            <span>{trimMessagePreview(message.reply_preview.text, 70)}</span>
          </div>
        ) : null}
        <p>{message.text}</p>
        {message.reactions?.length ? (
          <div className="msg-reaction-row">
            {message.reactions.map((reaction) => (
              <button
                key={`${message.message_id}-${reaction.emoji}`}
                type="button"
                className={`msg-reaction-chip ${reaction.reacted_by_me ? "mine" : ""}`.trim()}
                onClick={() => onReact(message, reaction.emoji)}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
            ))}
          </div>
        ) : null}
        <span>{new Date(message.sent_at).toLocaleString()}</span>
      </div>

      <div className={`msg-hover-actions ${isActive ? "visible" : ""}`.trim()}>
        <button type="button" className="msg-action" onClick={() => onReply(message)}>
          Reply
        </button>
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={`${message.message_id}-${emoji}`}
            type="button"
            className="msg-action emoji"
            onClick={() => onReact(message, emoji)}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          className={`msg-action ${pickerOpen ? "active" : ""}`.trim()}
          onClick={() => onTogglePicker(message.message_id)}
        >
          React
        </button>
        {!outgoing ? (
          <button type="button" className="msg-action danger" onClick={() => onReport(message)}>
            Report
          </button>
        ) : null}
        {!outgoing ? (
          <button type="button" className={`msg-action ${conversationBlocked ? "active" : ""}`.trim()} onClick={onBlockToggle}>
            {conversationBlocked ? "Unblock" : "Block"}
          </button>
        ) : null}
      </div>

      {pickerOpen ? (
        <div className="msg-reaction-picker">
          {EXTRA_REACTIONS.map((emoji) => (
            <button
              key={`${message.message_id}-extra-${emoji}`}
              type="button"
              className="msg-picker-emoji"
              onClick={() => onReact(message, emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function MessagesPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [inbox, setInbox] = useState([]);
  const [messages, setMessages] = useState([]);
  const [otherUser, setOtherUser] = useState(null);
  const [me, setMe] = useState(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [inboxErr, setInboxErr] = useState("");
  const [replyTarget, setReplyTarget] = useState(null);
  const [activeMessageId, setActiveMessageId] = useState(null);
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0].value);
  const [reportDetails, setReportDetails] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockSubmitting, setBlockSubmitting] = useState(false);
  const [blockError, setBlockError] = useState("");
  const [blockStatus, setBlockStatus] = useState("");
  const [blockedTick, setBlockedTick] = useState(0);

  const loadInbox = useCallback(async () => {
    try {
      setInboxErr("");
      const { data } = await API.get("/messages/inbox");
      setInbox(data || []);
    } catch (e) {
      if (e?.response?.status === 401) {
        localStorage.removeItem("token");
        navigate("/login");
        return;
      }
      setInbox([]);
      setInboxErr(
        isNetworkFailure(e)
          ? "The inbox could not be loaded right now. The backend may be offline or blocked by CORS."
          : e?.response?.data?.error || "Could not load inbox."
      );
    }
  }, [navigate]);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const { data } = await API.get("/me");
        if (!active) return;
        setMe(data || null);
      } catch (e) {
        if (!active) return;
        if (e?.response?.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [navigate]);

  const loadConversation = useCallback(
    async (targetUserId, { markRead = true } = {}) => {
      if (!targetUserId) {
        setLoading(false);
        setMessages([]);
        setOtherUser(null);
        return;
      }

      setLoading(true);
      setErr("");
      try {
        const [profileRes, convoRes] = await Promise.all([
          API.get(`/user/${targetUserId}`),
          API.get(`/messages/conversation/${targetUserId}`),
        ]);

        setOtherUser(profileRes.data);
        setMessages(convoRes.data || []);
        if (markRead) {
          await API.post(`/messages/${targetUserId}/read`);
        }
      } catch (e) {
        const status = e?.response?.status;
        if (status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        setErr(e?.response?.data?.error || e.message || "Failed to load conversation.");
      } finally {
        setLoading(false);
      }
    },
    [navigate]
  );

  function replaceMessage(updatedMessage) {
    setMessages((current) =>
      current.map((item) => (item.message_id === updatedMessage.message_id ? updatedMessage : item))
    );
  }

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    const shouldCollapse = Boolean(replyTarget || reportTarget || blockDialogOpen);
    setBottomNavCollapsed(shouldCollapse);
    return () => setBottomNavCollapsed(false);
  }, [blockDialogOpen, replyTarget, reportTarget]);

  useEffect(() => {
    if (!me?.user_id) return undefined;
    const syncBlocked = () => setBlockedTick((current) => current + 1);
    window.addEventListener(BLOCKED_USERS_CHANGED_EVENT, syncBlocked);
    window.addEventListener("storage", syncBlocked);
    return () => {
      window.removeEventListener(BLOCKED_USERS_CHANGED_EVENT, syncBlocked);
      window.removeEventListener("storage", syncBlocked);
    };
  }, [me?.user_id]);

  useEffect(() => {
    setReplyTarget(null);
    setActiveMessageId(null);
    setReactionPickerFor(null);
    setReportTarget(null);
    setReportReason(REPORT_REASONS[0].value);
    setReportDetails("");

    if (!userId) {
      setLoading(false);
      setMessages([]);
      setOtherUser(null);
      return;
    }

    loadConversation(userId).then(() => loadInbox());
  }, [loadConversation, loadInbox, userId]);

  const isBlockedConversation = useMemo(
    () => {
      void blockedTick;
      return Boolean(me?.user_id && otherUser?.user_id && isBlockedUser(me.user_id, otherUser));
    },
    [blockedTick, me?.user_id, otherUser]
  );

  function openBlockDialog() {
    if (!me?.user_id) {
      setBlockError("Log in again to manage blocked accounts.");
      return;
    }
    setBlockError("");
    setBlockStatus("");
    if (isBlockedConversation) {
      (async () => {
        try {
          setBlockSubmitting(true);
          await unblockUser(me.user_id, otherUser);
          setBlockStatus(`Unblocked @${otherUser?.handle || "this user"}.`);
        } catch (error) {
          setBlockError(error?.message || "Could not update blocked accounts right now.");
        } finally {
          setBlockSubmitting(false);
        }
      })();
      return;
    }
    setBlockDialogOpen(true);
  }

  async function confirmBlockUser() {
    if (!me?.user_id) {
      setBlockError("Log in again to manage blocked accounts.");
      return;
    }

    try {
      setBlockSubmitting(true);
      setBlockError("");
      setBlockStatus("");
      await blockUser(me.user_id, otherUser, { source: "messages" });
      setBlockStatus(`Blocked @${otherUser?.handle || "this user"}. You can undo it from Settings > Blocked accounts.`);
      setBlockDialogOpen(false);
    } catch (error) {
      setBlockError(error?.message || "Could not block that account right now.");
    } finally {
      setBlockSubmitting(false);
    }
  }

  async function sendMessage(e) {
    e.preventDefault();
    if (!userId || !text.trim()) return;
    if (isBlockedConversation) {
      setErr(`Unblock @${otherUser?.handle || "this user"} to send messages again.`);
      return;
    }

    try {
      setSending(true);
      await API.post("/messages/send", {
        recipient_id: Number(userId),
        text: text.trim(),
        reply_to_message_id: replyTarget?.message_id || undefined,
      });
      await loadConversation(userId, { markRead: false });
      await loadInbox();
      setText("");
      setReplyTarget(null);
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function handleReaction(message, emoji) {
    try {
      const { data } = await API.post(`/messages/${message.message_id}/react`, { emoji });
      if (data?.data) {
        replaceMessage(data.data);
      }
      setReactionPickerFor(null);
      setActiveMessageId(message.message_id);
    } catch (e) {
      setErr(e?.response?.data?.error || "Could not update that reaction.");
    }
  }

  async function submitMessageReport(e) {
    e.preventDefault();
    if (!reportTarget) return;

    try {
      setReportSubmitting(true);
      setReportError("");
      await API.post(`/messages/${reportTarget.message_id}/report`, {
        reason: reportReason,
        details: reportDetails.trim(),
      });
      setReportTarget(null);
      setReportReason(REPORT_REASONS[0].value);
      setReportDetails("");
    } catch (e) {
      setReportError(e?.response?.data?.error || "Could not report that message.");
    } finally {
      setReportSubmitting(false);
    }
  }

  function openReportModal(message) {
    setReportTarget(message);
    setReportReason(REPORT_REASONS[0].value);
    setReportDetails("");
    setReportError("");
  }

  function closeReportModal() {
    setReportTarget(null);
    setReportReason(REPORT_REASONS[0].value);
    setReportDetails("");
    setReportError("");
  }

  function handleDeactivate(messageId) {
    if (reactionPickerFor === messageId) return;
    setActiveMessageId((current) => (current === messageId ? null : current));
  }

  if (!userId) {
    return (
      <div className="messages-page">
        <header className="messages-head">
          <div>
            <p className="messages-kicker">Inbox</p>
            <h1>Messages</h1>
          </div>
        </header>

      <section className="messages-card">
        {inboxErr ? <p className="msg-error">{inboxErr}</p> : null}
        {inbox.length === 0 ? (
          <div className="msg-guide">
            <p className="msg-muted">No conversations yet. Open any listing and tap Message seller to start your first thread.</p>
            <Link className="msg-back" to="/browse">
              Browse listings
            </Link>
          </div>
        ) : (
          <div className="msg-inbox-list">
              {inbox.map((convo) => (
                <InboxItem key={convo.user_id} convo={convo} />
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="messages-page">
      <header className="messages-head card">
        <div>
          <p className="messages-kicker">Conversation</p>
          <h1>{otherUser ? `@${otherUser.handle}` : "Conversation"}</h1>
        </div>
        <div className="msg-head-actions">
          {otherUser ? (
            <button type="button" className="msg-head-block" onClick={openBlockDialog}>
              {isBlockedConversation ? "Unblock" : "Block"}
            </button>
          ) : null}
          <Link className="msg-back" to="/messages">
            Back to inbox
          </Link>
        </div>
      </header>

      {err && <p className="msg-error">{err}</p>}
      {blockStatus ? <p className="msg-status">{blockStatus}</p> : null}
      {blockError ? <p className="msg-error">{blockError}</p> : null}

      <section className="messages-layout">
        <aside className="messages-card msg-sidebar">
          <div className="msg-sidebar-head">
            <strong>Inbox</strong>
          </div>
          {inboxErr ? <p className="msg-error">{inboxErr}</p> : null}
          {inbox.length === 0 ? (
            <div className="msg-guide">
              <p className="msg-muted">No conversations yet. Start by messaging a seller from any listing, then return here to keep the thread going.</p>
              <Link className="msg-back" to="/browse">
                Browse listings
              </Link>
            </div>
          ) : (
            <div className="msg-inbox-list">
              {inbox.map((convo) => (
                <InboxItem key={convo.user_id} convo={convo} />
              ))}
            </div>
          )}
        </aside>

        <div className="messages-card msg-thread">
          {loading ? (
            <p className="msg-muted">Loading...</p>
          ) : messages.length === 0 ? (
            <div className="msg-guide">
              <p className="msg-muted">No messages yet. Send the first note about price, sizing, pickup, or availability.</p>
            </div>
          ) : (
            <div className="msg-thread-list">
              {messages.map((message) => (
                <MessageBubble
                  key={message.message_id}
                  message={message}
                  isActive={activeMessageId === message.message_id || reactionPickerFor === message.message_id}
                  pickerOpen={reactionPickerFor === message.message_id}
                  conversationBlocked={isBlockedConversation}
                  onActivate={setActiveMessageId}
                  onDeactivate={handleDeactivate}
                  onReply={setReplyTarget}
                  onReact={handleReaction}
                  onTogglePicker={(messageId) => {
                    setReactionPickerFor((current) => (current === messageId ? null : messageId));
                    setActiveMessageId(messageId);
                  }}
                  onReport={openReportModal}
                  onBlockToggle={openBlockDialog}
                />
              ))}
            </div>
          )}

          <div className={`safety-banner msg-safety-banner ${isBlockedConversation ? "blocked" : ""}`.trim()}>
            {isBlockedConversation ? (
              <>
                <strong>This conversation is blocked.</strong>
                <span>
                  Unblock @{otherUser?.handle || "this user"} to send new messages, react again, or keep the thread active.
                </span>
                <div className="safety-banner-actions">
                  <button type="button" className="safety-secondary" onClick={openBlockDialog}>
                    Unblock
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong>Safety controls</strong>
                <span>Block this account if you want to stop new messages and hide the thread from your search flow.</span>
                <div className="safety-banner-actions">
                  <button type="button" className="safety-secondary" onClick={openBlockDialog}>
                    Block user
                  </button>
                </div>
              </>
            )}
          </div>

          {replyTarget ? (
            <div className="msg-compose-reply">
              <div>
                <strong>Replying to {replyTarget.sender_name || replyTarget.sender_handle || "message"}</strong>
                <span>{trimMessagePreview(replyTarget.text, 110)}</span>
              </div>
              <button type="button" className="msg-reply-cancel" onClick={() => setReplyTarget(null)} aria-label="Cancel reply">
                <CloseIcon className="msg-reply-close" />
              </button>
            </div>
          ) : null}

          <form className="msg-compose" onSubmit={sendMessage}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                isBlockedConversation
                  ? `Unblock ${otherUser ? `@${otherUser.handle}` : "this user"} to send a new message.`
                  : `Message ${otherUser ? `@${otherUser.handle}` : "this user"}...`
              }
              rows={3}
              disabled={isBlockedConversation}
            />
            <button type="submit" disabled={sending || !text.trim() || isBlockedConversation}>
              {sending
                ? "Sending..."
                : isBlockedConversation
                  ? "Unblock to send"
                  : replyTarget
                    ? "Send reply"
                    : "Send"}
            </button>
          </form>
        </div>
      </section>

      {reportTarget ? (
        <>
          <div className="msg-modal-backdrop" onClick={closeReportModal} />
          <div className="msg-modal" role="dialog" aria-modal="true">
            <div className="msg-modal-head">
              <div>
                <p className="messages-kicker">Safety</p>
                <h2>Report message</h2>
              </div>
              <button type="button" className="msg-modal-close" onClick={closeReportModal} aria-label="Close report dialog">
                <CloseIcon className="msg-modal-close-icon" />
              </button>
            </div>

            <div className="msg-modal-copy">
              <strong>{reportTarget.sender_name || reportTarget.sender_handle || "Message sender"}</strong>
              <span>{trimMessagePreview(reportTarget.text, 140)}</span>
            </div>

            <form className="msg-report-form" onSubmit={submitMessageReport}>
              <label>
                <span>Reason</span>
                <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                  {REPORT_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Details</span>
                <textarea
                  rows={4}
                  value={reportDetails}
                  onChange={(event) => setReportDetails(event.target.value)}
                  placeholder="Add any context that helps moderation handle this quickly."
                />
              </label>
              {reportError ? <p className="msg-error">{reportError}</p> : null}
              <div className="msg-modal-actions">
                <button type="button" className="msg-modal-secondary" onClick={closeReportModal}>
                  Cancel
                </button>
                <button type="submit" className="msg-modal-primary" disabled={reportSubmitting}>
                  {reportSubmitting ? "Submitting..." : "Submit report"}
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}

      <BlockUserDialog
        open={blockDialogOpen}
        user={otherUser}
        currentUserLabel={me?.handle ? `@${me.handle}` : "your account"}
        title={`Block @${otherUser?.handle || "this user"}?`}
        description="Blocking hides this user from your search, messaging, and profile surfaces across your account until you unblock them."
        actionLabel="Block account"
        busyLabel="Blocking..."
        submitting={blockSubmitting}
        error={blockError}
        status={blockStatus}
        onCancel={() => {
          setBlockDialogOpen(false);
          setBlockError("");
        }}
        onConfirm={confirmBlockUser}
      />
    </div>
  );
}
