import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../api/axios";
import Avatar from "../components/Avatar";
import "../styles/AdminWorkspacePage.css";

const REPORT_ACTION_OPTIONS = {
  post: [
    { value: "no_action", label: "No action" },
    { value: "warn_user", label: "Warn seller" },
    { value: "hide_post", label: "Hide listing" },
    { value: "delete_post", label: "Remove listing" },
    { value: "suspend_user", label: "Suspend seller" },
    { value: "ban_user", label: "Ban seller" },
  ],
  user: [
    { value: "no_action", label: "No action" },
    { value: "warn_user", label: "Warn account" },
    { value: "delete_account", label: "Delete account" },
    { value: "suspend_user", label: "Suspend account" },
    { value: "ban_user", label: "Ban account" },
  ],
  message: [
    { value: "no_action", label: "No action" },
    { value: "warn_user", label: "Warn sender" },
    { value: "delete_message", label: "Remove message" },
    { value: "suspend_user", label: "Suspend sender" },
    { value: "ban_user", label: "Ban sender" },
  ],
};

function reportKey(report) {
  return `${report.report_type}-${report.report_id}`;
}

function buildReportDraft(report) {
  return {
    status: report.review?.status || "open",
    action_taken: report.review?.action_taken || "",
    note: report.review?.note || "",
  };
}

function actionOptionsForReport(report) {
  return REPORT_ACTION_OPTIONS[report?.report_type] || REPORT_ACTION_OPTIONS.message;
}

function reviewStatusForReport(report) {
  return String(report?.review?.status || "open").trim().toLowerCase();
}

function buildTicketDraft(ticket) {
  return {
    status: ticket.status || "open",
    priority: ticket.priority || "normal",
    resolution_note: ticket.resolution_note || "",
  };
}

export default function AdminWorkspacePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [reports, setReports] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [chapterRequests, setChapterRequests] = useState([]);
  const [siteAdmins, setSiteAdmins] = useState([]);
  const [reportDrafts, setReportDrafts] = useState({});
  const [ticketDrafts, setTicketDrafts] = useState({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [userSearch, setUserSearch] = useState("");
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [actionState, setActionState] = useState({ kind: "", id: "" });
  const [flash, setFlash] = useState("");
  const [flashError, setFlashError] = useState("");

  useEffect(() => {
    let active = true;

    (async () => {
      setLoading(true);
      setError("");
      setFlash("");
      setFlashError("");
      try {
        const summaryRes = await API.get("/admin/workspace");
        if (!active) return;

        const isOwner = Boolean(summaryRes.data?.admin?.is_owner);
        const requests = [
          API.get("/admin/reports"),
          API.get("/admin/support-tickets"),
          API.get("/admin/chapters"),
          API.get("/admin/chapter-requests"),
        ];
        if (isOwner) {
          requests.push(API.get("/admin/site-admins"));
        }

        const settled = await Promise.all(requests);
        if (!active) return;

        const [reportsRes, ticketsRes, chaptersRes, chapterRequestsRes, siteAdminsRes] = settled;
        const nextReports = reportsRes.data || [];
        const nextTickets = ticketsRes.data || [];
        setSummary(summaryRes.data);
        setReports(nextReports);
        setTickets(nextTickets);
        setChapters(chaptersRes.data || []);
        setChapterRequests(chapterRequestsRes.data || []);
        setSiteAdmins(isOwner ? siteAdminsRes?.data || [] : []);
        setReportDrafts(
          Object.fromEntries(nextReports.map((report) => [reportKey(report), buildReportDraft(report)]))
        );
        setTicketDrafts(
          Object.fromEntries(nextTickets.map((ticket) => [String(ticket.ticket_id), buildTicketDraft(ticket)]))
        );
      } catch (err) {
        if (!active) return;
        if (err?.response?.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        if (err?.response?.status === 403) {
          setError("This workspace is only available to site admins.");
        } else {
          setError(err?.response?.data?.error || "Could not load the admin workspace.");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [navigate, refreshKey]);

  const isOwner = Boolean(summary?.admin?.is_owner);
  const queueReports = useMemo(
    () => reports.filter((report) => ["open", "in_progress"].includes(reviewStatusForReport(report))),
    [reports]
  );
  const openTickets = useMemo(
    () => tickets.filter((ticket) => ticket.status !== "resolved"),
    [tickets]
  );
  const pendingChapterRequests = useMemo(
    () => chapterRequests.filter((item) => item.status === "pending"),
    [chapterRequests]
  );

  function updateReportDraft(report, patch) {
    const key = reportKey(report);
    const currentDraft = reportDrafts[key] || buildReportDraft(report);
    const nextDraft = { ...currentDraft, ...patch };
    if (patch.status === "dismissed" && !nextDraft.action_taken) {
      nextDraft.action_taken = "no_action";
    }
    setReportDrafts((current) => ({
      ...current,
      [key]: nextDraft,
    }));
  }

  function updateTicketDraft(ticket, patch) {
    const key = String(ticket.ticket_id);
    setTicketDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] || buildTicketDraft(ticket)), ...patch },
    }));
  }

  async function saveReport(report) {
    const key = reportKey(report);
    const draft = { ...(reportDrafts[key] || buildReportDraft(report)) };
    if (draft.status === "dismissed" && !draft.action_taken) {
      draft.action_taken = "no_action";
    }
    setActionState({ kind: "report", id: key });
    setFlash("");
    setFlashError("");
    try {
      const { data } = await API.patch(`/admin/reports/${report.report_type}/${report.report_id}`, draft);
      const nextReport = data.report;
      const nextStatus = reviewStatusForReport(nextReport) || draft.status;
      if (["dismissed", "resolved"].includes(nextStatus)) {
        setReports((current) =>
          current.filter(
            (item) => !(item.report_type === report.report_type && item.report_id === report.report_id)
          )
        );
        setReportDrafts((current) => {
          const nextDrafts = { ...current };
          delete nextDrafts[key];
          return nextDrafts;
        });
        setSummary((current) => {
          if (!current) return current;
          const overview = { ...current.overview };
          if (report.report_type === "post") {
            overview.open_post_reports = Math.max(0, Number(overview.open_post_reports || 0) - 1);
          } else if (report.report_type === "user") {
            overview.open_user_reports = Math.max(0, Number(overview.open_user_reports || 0) - 1);
          } else if (report.report_type === "message") {
            overview.open_message_reports = Math.max(0, Number(overview.open_message_reports || 0) - 1);
          }
          return { ...current, overview };
        });
        setFlash(
          nextStatus === "dismissed"
            ? "Report dismissed and removed from the queue."
            : "Report resolved and removed from the queue."
        );
      } else {
        setReports((current) =>
          current.map((item) =>
            item.report_type === report.report_type && item.report_id === report.report_id ? nextReport : item
          )
        );
        setReportDrafts((current) => ({
          ...current,
          [key]: buildReportDraft(nextReport),
        }));
        setFlash("Report queue updated.");
      }
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not update that report.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function saveTicket(ticket, extraPayload = {}) {
    const key = String(ticket.ticket_id);
    const draft = ticketDrafts[key] || buildTicketDraft(ticket);
    setActionState({ kind: "ticket", id: key });
    setFlash("");
    setFlashError("");
    try {
      const { data } = await API.patch(`/admin/support-tickets/${ticket.ticket_id}`, {
        ...draft,
        ...extraPayload,
      });
      setTickets((current) =>
        current.map((item) => (item.ticket_id === ticket.ticket_id ? data.ticket : item))
      );
      setFlash("Support ticket updated.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not update that support ticket.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function removeReportedPost(report) {
    const postId = report.post?.post_id;
    if (!postId || !window.confirm("Remove this listing from the marketplace?")) return;
    setActionState({ kind: "report-delete-post", id: String(postId) });
    setFlash("");
    setFlashError("");
    try {
      await API.delete(`/admin/posts/${postId}`);
      const draft = reportDrafts[reportKey(report)] || buildReportDraft(report);
      const { data } = await API.patch(`/admin/reports/post/${report.report_id}`, {
        ...draft,
        status: "resolved",
        action_taken: "delete_post",
        note: draft.note || "Reported listing removed by admin.",
      });
      setReports((current) =>
        current.map((item) =>
          item.report_type === "post" && item.report_id === report.report_id ? data.report : item
        )
      );
      setFlash("Reported listing removed.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not remove that listing.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function removeReportedUser(report) {
    const userId = report.reported_user?.user_id;
    if (!userId || !window.confirm("Delete this account and all related content?")) return;
    setActionState({ kind: "report-delete-user", id: String(userId) });
    setFlash("");
    setFlashError("");
    try {
      await API.delete(`/admin/users/${userId}`);
      setReports((current) =>
        current.filter((item) => !(item.report_type === "user" && item.report_id === report.report_id))
      );
      setFlash("Reported account removed.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not remove that account.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function removeReportedMessage(report) {
    const messageId = report.message?.message_id;
    if (!messageId || !window.confirm("Remove this message from the conversation?")) return;
    setActionState({ kind: "report-delete-message", id: String(messageId) });
    setFlash("");
    setFlashError("");
    try {
      await API.delete(`/admin/messages/${messageId}`);
      setReports((current) =>
        current.filter((item) => !(item.report_type === "message" && item.report_id === report.report_id))
      );
      setFlash("Reported message removed.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not remove that message.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function updateChapterRole(chapterId, member, role) {
    const actionId = `${chapterId}-${member.user_id}-${role}`;
    setActionState({ kind: "chapter-role", id: actionId });
    setFlash("");
    setFlashError("");
    try {
      const { data } = await API.patch(`/admin/chapters/${chapterId}/members/${member.user_id}`, { role });
      setChapters((current) =>
        current.map((chapterEntry) =>
          chapterEntry.chapter.chapter_id === chapterId
            ? {
                ...chapterEntry,
                members: chapterEntry.members.map((item) =>
                  item.user_id === member.user_id ? { ...item, ...data.member } : item
                ),
              }
            : chapterEntry
        )
      );
      setFlash("Chapter role updated.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not update that chapter role.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function removeChapterMember(chapterId, member) {
    const actionId = `${chapterId}-${member.user_id}`;
    if (!window.confirm("Remove this member from the chapter?")) return;
    setActionState({ kind: "chapter-remove", id: actionId });
    setFlash("");
    setFlashError("");
    try {
      await API.delete(`/admin/chapters/${chapterId}/members/${member.user_id}`);
      setChapters((current) =>
        current.map((chapterEntry) =>
          chapterEntry.chapter.chapter_id === chapterId
            ? {
                ...chapterEntry,
                member_count: Math.max(0, chapterEntry.member_count - 1),
                members: chapterEntry.members.filter((item) => item.user_id !== member.user_id),
              }
            : chapterEntry
        )
      );
      setFlash("Member removed from chapter.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not remove that chapter member.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function reviewChapterRequest(item, status) {
    setActionState({ kind: "chapter-request", id: String(item.request_id) });
    setFlash("");
    setFlashError("");
    try {
      const { data } = await API.patch(`/admin/chapter-requests/${item.request_id}`, { status });
      setChapterRequests((current) =>
        current.map((entry) => (entry.request_id === item.request_id ? data.request : entry))
      );
      setFlash(`Chapter request ${status}.`);
      setRefreshKey((current) => current + 1);
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not update that chapter request.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function searchUsers(event) {
    event?.preventDefault();
    if (!userSearch.trim()) {
      setUserSearchResults([]);
      return;
    }

    setSearchingUsers(true);
    setFlash("");
    setFlashError("");
    try {
      const { data } = await API.get("/admin/users/search", {
        params: { q: userSearch.trim() },
      });
      setUserSearchResults(data || []);
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not search users right now.");
    } finally {
      setSearchingUsers(false);
    }
  }

  async function addSiteAdmin(user) {
    setActionState({ kind: "site-admin-add", id: String(user.user_id) });
    setFlash("");
    setFlashError("");
    try {
      await API.post("/admin/site-admins", { user_id: user.user_id });
      setRefreshKey((current) => current + 1);
      setFlash("Site admin granted.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not grant site-admin access.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  async function removeSiteAdmin(user) {
    if (!window.confirm(`Remove site-admin access for ${user.display_name || user.email}?`)) return;
    setActionState({ kind: "site-admin-remove", id: String(user.user_id) });
    setFlash("");
    setFlashError("");
    try {
      await API.delete(`/admin/site-admins/${user.user_id}`);
      setSiteAdmins((current) => current.filter((item) => item.user_id !== user.user_id));
      setFlash("Site admin removed.");
    } catch (err) {
      setFlashError(err?.response?.data?.error || "Could not remove that site admin.");
    } finally {
      setActionState({ kind: "", id: "" });
    }
  }

  if (loading) {
    return (
      <div className="admin-page">
        <section className="admin-hero card">
          <p className="eyebrow">Admin workspace</p>
          <h1>Loading operations hub...</h1>
          <p className="muted">Pulling support, reports, chapters, and admin controls.</p>
        </section>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="admin-page">
        <section className="admin-hero card">
          <p className="eyebrow">Admin workspace</p>
          <h1>Access unavailable</h1>
          <p className="muted">{error || "This workspace could not be loaded."}</p>
          <div className="admin-header-actions">
            <button type="button" className="secondary-action" onClick={() => setRefreshKey((current) => current + 1)}>
              Retry workspace
            </button>
            <button type="button" className="secondary-action" onClick={() => navigate("/dashboard")}>
              Back to dashboard
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <section className="admin-hero card">
        <div>
          <p className="eyebrow">Admin workspace</p>
          <h1>Operations, support, and moderation</h1>
          <p className="muted">
            Handle customer support, triage reports, manage chapter admins, and control site-admin access from one place.
          </p>
        </div>
        <div className="admin-header-actions">
          <button type="button" className="secondary-action" onClick={() => setRefreshKey((current) => current + 1)}>
            Refresh workspace
          </button>
          <Link className="primary-action" to="/dashboard">
            Back to dashboard
          </Link>
        </div>
      </section>

      {flash ? <div className="admin-flash success">{flash}</div> : null}
      {flashError ? <div className="admin-flash error">{flashError}</div> : null}

      <section className="admin-overview-grid">
        <div className="admin-stat card">
          <span>Open support</span>
          <strong>{summary.overview.open_support_tickets}</strong>
        </div>
        <div className="admin-stat card">
          <span>Open post reports</span>
          <strong>{summary.overview.open_post_reports}</strong>
        </div>
        <div className="admin-stat card">
          <span>Open user reports</span>
          <strong>{summary.overview.open_user_reports}</strong>
        </div>
        <div className="admin-stat card">
          <span>Open message reports</span>
          <strong>{summary.overview.open_message_reports}</strong>
        </div>
        <div className="admin-stat card">
          <span>Pending chapter requests</span>
          <strong>{summary.overview.pending_chapter_requests ?? pendingChapterRequests.length}</strong>
        </div>
        <div className="admin-stat card">
          <span>Total users</span>
          <strong>{summary.overview.total_users}</strong>
        </div>
        <div className="admin-stat card">
          <span>Total posts</span>
          <strong>{summary.overview.total_posts}</strong>
        </div>
        <div className="admin-stat card">
          <span>Total chapters</span>
          <strong>{summary.overview.total_chapters}</strong>
        </div>
      </section>

      <div className="admin-grid">
        <section className="admin-panel card">
          <div className="admin-panel-head">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>Support inbox</h2>
            </div>
            <span className="admin-count">{openTickets.length}</span>
          </div>
          <div className="admin-list">
            {tickets.length ? (
              tickets.map((ticket) => {
                const draft = ticketDrafts[String(ticket.ticket_id)] || buildTicketDraft(ticket);
                const busy = actionState.kind === "ticket" && actionState.id === String(ticket.ticket_id);
                return (
                  <article key={ticket.ticket_id} className="admin-card ticket-card">
                    <div className="admin-card-head">
                      <div>
                        <strong>{ticket.subject}</strong>
                        <span>{ticket.email}</span>
                      </div>
                      <div className="admin-chip-row">
                        <span className={`admin-chip ${ticket.status}`}>{ticket.status.replace("_", " ")}</span>
                        <span className={`admin-chip priority-${ticket.priority}`}>{ticket.priority}</span>
                      </div>
                    </div>
                    <p className="admin-body-copy">{ticket.message}</p>
                    <div className="admin-field-grid">
                      <label>
                        <span>Status</span>
                        <select
                          value={draft.status}
                          onChange={(event) => updateTicketDraft(ticket, { status: event.target.value })}
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                        </select>
                      </label>
                      <label>
                        <span>Priority</span>
                        <select
                          value={draft.priority}
                          onChange={(event) => updateTicketDraft(ticket, { priority: event.target.value })}
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                      </label>
                    </div>
                    <label className="admin-note-field">
                      <span>Resolution note</span>
                      <textarea
                        rows={4}
                        value={draft.resolution_note}
                        onChange={(event) => updateTicketDraft(ticket, { resolution_note: event.target.value })}
                        placeholder="Leave handling notes, follow-up steps, or the reply you sent."
                      />
                    </label>
                    <div className="admin-card-actions">
                      <button type="button" className="secondary-action" disabled={busy} onClick={() => saveTicket(ticket, { assign_to_me: true })}>
                        {busy ? "Saving..." : "Assign to me"}
                      </button>
                      <button type="button" className="primary-action" disabled={busy} onClick={() => saveTicket(ticket)}>
                        {busy ? "Saving..." : "Save ticket"}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="admin-empty">No support tickets yet.</div>
            )}
          </div>
        </section>

        <section className="admin-panel card">
          <div className="admin-panel-head">
            <div>
              <p className="eyebrow">Moderation</p>
              <h2>Reports queue</h2>
            </div>
            <span className="admin-count">{queueReports.length}</span>
          </div>
          <div className="admin-list">
            {queueReports.length ? (
              queueReports.map((report) => {
                const key = reportKey(report);
                const draft = reportDrafts[key] || buildReportDraft(report);
                const busy = actionState.kind === "report" && actionState.id === key;
                return (
                  <article key={key} className="admin-card report-card">
                    <div className="admin-card-head">
                      <div>
                        <strong>
                          {report.report_type === "post"
                            ? "Reported listing"
                            : report.report_type === "message"
                              ? "Reported message"
                              : "Reported account"}
                        </strong>
                        <span>{report.reporter?.display_name || report.reporter?.email || "Unknown reporter"}</span>
                      </div>
                      <span className={`admin-chip ${report.review?.status || "open"}`}>
                        {(report.review?.status || "open").replace("_", " ")}
                      </span>
                    </div>
                    {report.post ? (
                      <div className="admin-report-target">
                        <strong>{report.post.title}</strong>
                        <span>{report.post.price != null ? `$${Number(report.post.price).toFixed(2)}` : "Free"}</span>
                      </div>
                    ) : null}
                    {report.reported_user ? (
                      <div className="admin-report-target">
                        <strong>{report.reported_user.display_name}</strong>
                        <span>@{report.reported_user.handle}</span>
                      </div>
                    ) : null}
                    {report.message ? (
                      <div className="admin-report-target">
                        <strong>{report.message.sender_name || report.message.sender_handle || "Message sender"}</strong>
                        <span>{report.message.text}</span>
                      </div>
                    ) : null}
                    <p className="admin-body-copy">{report.reason || "No reason provided."}</p>
                    {report.details ? <p className="admin-body-copy">{report.details}</p> : null}
                    <div className="admin-field-grid">
                      <label>
                        <span>Status</span>
                        <select
                          value={draft.status}
                          onChange={(event) => updateReportDraft(report, { status: event.target.value })}
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In Progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="dismissed">Dismissed</option>
                        </select>
                      </label>
                      <label>
                        <span>Action taken</span>
                        <select
                          value={draft.action_taken}
                          onChange={(event) => updateReportDraft(report, { action_taken: event.target.value })}
                        >
                          <option value="">Select action</option>
                          {actionOptionsForReport(report).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="admin-note-field">
                      <span>Internal note</span>
                      <textarea
                        rows={4}
                        value={draft.note}
                        onChange={(event) => updateReportDraft(report, { note: event.target.value })}
                        placeholder="Document what happened, what you reviewed, and the next step."
                      />
                    </label>
                    <div className="admin-card-actions">
                      {report.report_type === "post" && report.post?.post_id ? (
                        <button
                          type="button"
                          className="secondary-action danger"
                          disabled={actionState.kind === "report-delete-post" && actionState.id === String(report.post.post_id)}
                          onClick={() => removeReportedPost(report)}
                        >
                          Remove listing
                        </button>
                      ) : null}
                      {report.report_type === "user" && report.reported_user?.user_id ? (
                        <button
                          type="button"
                          className="secondary-action danger"
                          disabled={actionState.kind === "report-delete-user" && actionState.id === String(report.reported_user.user_id)}
                          onClick={() => removeReportedUser(report)}
                        >
                          Delete account
                        </button>
                      ) : null}
                      {report.report_type === "message" && report.message?.message_id ? (
                        <button
                          type="button"
                          className="secondary-action danger"
                          disabled={actionState.kind === "report-delete-message" && actionState.id === String(report.message.message_id)}
                          onClick={() => removeReportedMessage(report)}
                        >
                          Remove message
                        </button>
                      ) : null}
                      <button type="button" className="primary-action" disabled={busy} onClick={() => saveReport(report)}>
                        {busy ? "Saving..." : "Save review"}
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="admin-empty">No active reports are waiting right now. Dismissed and resolved reports are cleared from this queue automatically.</div>
            )}
          </div>
        </section>
      </div>

      <section className="admin-panel card">
        <div className="admin-panel-head">
          <div>
            <p className="eyebrow">Membership requests</p>
            <h2>Chapter onboarding approvals</h2>
          </div>
          <span className="admin-count">{pendingChapterRequests.length}</span>
        </div>
        <div className="admin-list">
          {chapterRequests.length ? (
            chapterRequests.map((item) => {
              const busy = actionState.kind === "chapter-request" && actionState.id === String(item.request_id);
              return (
                <article key={item.request_id} className="admin-card report-card">
                  <div className="admin-card-head">
                    <div>
                      <strong>{item.chapter?.name || "Chapter request"}</strong>
                      <span>
                        {item.requester?.display_name || "Unknown requester"} wants {item.requested_role} access
                      </span>
                    </div>
                    <span className={`admin-chip ${item.status}`}>{item.status}</span>
                  </div>
                  <div className="admin-report-target">
                    <strong>@{item.requester?.handle || "unknown"}</strong>
                    <span>{item.chapter?.school_name || "School not set"}</span>
                  </div>
                  {item.note ? <p className="admin-body-copy">{item.note}</p> : null}
                  <div className="admin-card-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      disabled={busy || item.status !== "pending"}
                      onClick={() => reviewChapterRequest(item, "approved")}
                    >
                      {busy ? "Saving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="secondary-action danger"
                      disabled={busy || item.status !== "pending"}
                      onClick={() => reviewChapterRequest(item, "rejected")}
                    >
                      {busy ? "Saving..." : "Reject"}
                    </button>
                  </div>
                </article>
              );
            })
          ) : (
            <div className="admin-empty">No chapter onboarding requests yet.</div>
          )}
        </div>
      </section>

      <section className="admin-panel card">
        <div className="admin-panel-head">
          <div>
            <p className="eyebrow">Chapters</p>
            <h2>Admin roles and membership control</h2>
          </div>
          <span className="admin-count">{chapters.length}</span>
        </div>
        <div className="chapter-admin-grid">
          {chapters.length ? (
            chapters.map((entry) => (
              <article key={entry.chapter.chapter_id} className="chapter-admin-card">
                <div className="admin-card-head">
                  <div>
                    <strong>{entry.chapter.name}</strong>
                    <span>{entry.chapter.school_name || "School not set"}</span>
                  </div>
                  <span className="admin-chip">{entry.member_count} members</span>
                </div>
                <div className="chapter-member-list">
                  {entry.members.length ? (
                    entry.members.map((member) => {
                      const roleTarget = member.role === "admin" ? "member" : "admin";
                      const roleBusyId = `${entry.chapter.chapter_id}-${member.user_id}-${roleTarget}`;
                      const removeBusyId = `${entry.chapter.chapter_id}-${member.user_id}`;
                      return (
                        <div key={member.user_id} className="chapter-member-card">
                          <div className="chapter-member-copy">
                            <Avatar
                              size="sm"
                              user={{
                                first_name: member.first_name,
                                last_name: member.last_name,
                                handle: member.handle,
                                profile_picture_url: member.profile_picture_url,
                              }}
                            />
                            <div>
                              <strong>{member.display_name}</strong>
                              <span>@{member.handle}</span>
                              <span>{member.role}</span>
                            </div>
                          </div>
                          <div className="chapter-member-actions">
                            <button
                              type="button"
                              className="secondary-action"
                              disabled={actionState.kind === "chapter-role" && actionState.id === roleBusyId}
                              onClick={() => updateChapterRole(entry.chapter.chapter_id, member, roleTarget)}
                            >
                              {member.role === "admin" ? "Demote" : "Promote"}
                            </button>
                            <button
                              type="button"
                              className="secondary-action danger"
                              disabled={actionState.kind === "chapter-remove" && actionState.id === removeBusyId}
                              onClick={() => removeChapterMember(entry.chapter.chapter_id, member)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="admin-empty">No members in this chapter yet.</div>
                  )}
                </div>
              </article>
            ))
          ) : (
            <div className="admin-empty">No chapters available yet.</div>
          )}
        </div>
      </section>

      {isOwner ? (
        <section className="admin-panel card">
          <div className="admin-panel-head">
            <div>
              <p className="eyebrow">Owner controls</p>
              <h2>Site-admin access</h2>
            </div>
            <span className="admin-count">{siteAdmins.length}</span>
          </div>
          <form className="admin-search-row" onSubmit={searchUsers}>
            <input
              type="text"
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Search users by email, handle, or name"
            />
            <button type="submit" className="primary-action" disabled={searchingUsers}>
              {searchingUsers ? "Searching..." : "Search users"}
            </button>
          </form>

          {userSearchResults.length ? (
            <div className="admin-list">
              {userSearchResults.map((user) => (
                <article key={user.user_id} className="admin-card site-admin-card">
                  <div className="chapter-member-copy">
                    <Avatar
                      size="sm"
                      user={{
                        first_name: user.first_name,
                        last_name: user.last_name,
                        handle: user.handle,
                        profile_picture_url: user.profile_picture_url,
                      }}
                    />
                    <div>
                      <strong>{user.display_name}</strong>
                      <span>{user.email}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="primary-action"
                    disabled={actionState.kind === "site-admin-add" && actionState.id === String(user.user_id)}
                    onClick={() => addSiteAdmin(user)}
                  >
                    Grant site admin
                  </button>
                </article>
              ))}
            </div>
          ) : userSearch ? (
            <div className="admin-empty">No matching users yet.</div>
          ) : null}

          <div className="admin-list">
            {siteAdmins.map((user) => (
              <article key={user.user_id} className="admin-card site-admin-card">
                <div className="chapter-member-copy">
                  <Avatar
                    size="sm"
                    user={{
                      first_name: user.first_name,
                      last_name: user.last_name,
                      handle: user.handle,
                      profile_picture_url: user.profile_picture_url,
                    }}
                  />
                  <div>
                    <strong>{user.display_name}</strong>
                    <span>{user.email}</span>
                    <span>{user.source === "owner" ? "Owner-level admin" : "Site admin"}</span>
                  </div>
                </div>
                {user.is_owner ? (
                  <span className="admin-chip">Owner</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-action danger"
                    disabled={actionState.kind === "site-admin-remove" && actionState.id === String(user.user_id)}
                    onClick={() => removeSiteAdmin(user)}
                  >
                    Remove admin
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
