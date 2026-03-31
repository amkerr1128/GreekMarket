/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import API from "../api/axios";
import {
  applyViewedState,
  createLocalNotification,
  dedupeNotifications,
  deriveInboxNotifications,
  getManualNotifications,
  getViewedNotificationKeys,
  markNotificationViewed as persistNotificationViewed,
  markNotificationsViewed as persistNotificationsViewed,
  normalizeNotificationList,
  saveManualNotification,
} from "../utils/notifications";

const NotificationContext = createContext(null);

function isMissingNotificationsEndpoint(error) {
  const status = error?.response?.status;
  return status === 404 || status === 405;
}

export function NotificationProvider({ children }) {
  const location = useLocation();
  const [accountKey, setAccountKey] = useState("guest");
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [remoteAvailable, setRemoteAvailable] = useState(false);

  const refreshNotifications = useCallback(async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      setAccountKey("guest");
      setNotifications([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data: me } = await API.get("/me");
      const nextAccountKey = String(me?.user_id || me?.id || "guest");
      const viewedKeys = getViewedNotificationKeys(nextAccountKey);
      const manualNotifications = getManualNotifications(nextAccountKey);
      let nextNotifications = [];
      let usedRemoteNotifications = false;

      try {
        const { data } = await API.get("/notifications", {
          params: { mark_read: "false" },
        });
        nextNotifications = normalizeNotificationList(Array.isArray(data) ? data : data?.notifications || data?.items || []);
        usedRemoteNotifications = true;
        setRemoteAvailable(true);
      } catch (notificationError) {
        if (!isMissingNotificationsEndpoint(notificationError)) {
          setRemoteAvailable(false);
        } else {
          setRemoteAvailable(false);
        }
      }

      if (!usedRemoteNotifications || nextNotifications.length === 0) {
        try {
          const { data } = await API.get("/messages/inbox");
          const inboxNotifications = deriveInboxNotifications(Array.isArray(data) ? data : []);
          nextNotifications = dedupeNotifications([...inboxNotifications, ...nextNotifications]);
        } catch {
          // Ignore inbox failures and keep manual notifications available.
        }
      }

      nextNotifications = dedupeNotifications([...nextNotifications, ...manualNotifications]);
      nextNotifications = applyViewedState(nextNotifications, viewedKeys);
      setAccountKey(nextAccountKey);
      setNotifications(nextNotifications);
    } catch (refreshError) {
      const status = refreshError?.response?.status;
      if (status === 401) {
        setAccountKey("guest");
        setNotifications([]);
        setError("");
        setLoading(false);
        return;
      }
      setError("Notifications could not be loaded right now. Refresh the page and try again.");
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshNotifications();
  }, [location.pathname, refreshNotifications]);

  useEffect(() => {
    const handleFocus = () => {
      refreshNotifications();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshNotifications]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.viewedAt).length,
    [notifications]
  );

  const markViewed = useCallback(
    async (notification) => {
      if (!notification) return;
      persistNotificationViewed(notification, accountKey);
      setNotifications((current) =>
        current.map((item) =>
          (item.sourceKey || item.id) === (notification.sourceKey || notification.id)
            ? { ...item, viewedAt: item.viewedAt || item.createdAt }
            : item
        )
      );

      if (remoteAvailable && /^\d+$/.test(String(notification.id || ""))) {
        try {
          await API.post(`/notifications/${notification.id}/read`);
        } catch {
          // Keep the UI responsive even if the remote read acknowledgement fails.
        }
      }
    },
    [accountKey, remoteAvailable]
  );

  const markAllViewed = useCallback(() => {
    persistNotificationsViewed(notifications, accountKey);
    setNotifications((current) =>
      current.map((item) => ({
        ...item,
        viewedAt: item.viewedAt || item.createdAt,
      }))
    );
    if (remoteAvailable) {
      API.post("/notifications/mark-read", {}).catch(() => {
        // Ignore remote failures here because the opened notification center should still clear locally.
      });
    }
  }, [accountKey, notifications, remoteAvailable]);

  const pushNotification = useCallback(
    (notificationInput) => {
      const notification = createLocalNotification(notificationInput || {});
      saveManualNotification(notification, accountKey);
      setNotifications((current) => dedupeNotifications([notification, ...current]));
      return notification;
    },
    [accountKey]
  );

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      error,
      remoteAvailable,
      refreshNotifications,
      markViewed,
      markAllViewed,
      pushNotification,
    }),
    [error, loading, markAllViewed, markViewed, notifications, pushNotification, refreshNotifications, remoteAvailable, unreadCount]
  );

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return context;
}
