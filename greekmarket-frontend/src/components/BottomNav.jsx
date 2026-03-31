import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useNotifications } from "../context/NotificationsContext";
import "../styles/BottomNav.css";
import { BellIcon, ChevronDownIcon, HomeIcon, PlusIcon, SearchIcon, UserIcon } from "./icons";
import { subscribeToBottomNav } from "../utils/bottomNav";

function BottomNav() {
  const location = useLocation();
  const { unreadCount } = useNotifications();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    return subscribeToBottomNav((nextCollapsed) => {
      setCollapsed(nextCollapsed);
    });
  }, []);

  const isActive = (section) => {
    const path = location.pathname;

    switch (section) {
      case "home":
        return path === "/browse" || path.startsWith("/post/");
      case "create":
        return path === "/create";
      case "search":
        return path === "/search" || path.startsWith("/school/") || path.startsWith("/chapter/");
      case "notifications":
        return path === "/notifications";
      case "profile":
        return path === "/dashboard" || path.startsWith("/user/");
      default:
        return false;
    }
  };

  return (
    <div className={`bottom-nav-shell ${collapsed ? "collapsed" : ""}`.trim()}>
      <button
        type="button"
        className="bottom-nav-toggle"
        aria-label={collapsed ? "Show navigation" : "Hide navigation"}
        onClick={() => setCollapsed((current) => !current)}
      >
        <ChevronDownIcon className="bottom-nav-toggle-icon" />
      </button>

      <nav className="bottom-nav">
        <Link to="/browse" className={`nav-item ${isActive("home") ? "active" : ""}`}>
          <span className="nav-icon" aria-hidden="true">
            <HomeIcon className="nav-svg" />
          </span>
          <span>Home</span>
        </Link>

        <Link to="/create" className={`nav-item ${isActive("create") ? "active" : ""}`}>
          <span className="nav-icon" aria-hidden="true">
            <PlusIcon className="nav-svg" />
          </span>
          <span>Post</span>
        </Link>

        <Link to="/search" className={`nav-item ${isActive("search") ? "active" : ""}`}>
          <span className="nav-icon" aria-hidden="true">
            <SearchIcon className="nav-svg" />
          </span>
          <span>Search</span>
        </Link>

        <Link to="/notifications" className={`nav-item ${isActive("notifications") ? "active" : ""}`}>
          <span className="nav-icon" aria-hidden="true">
            <BellIcon className="nav-svg nav-svg-bell" />
            {unreadCount > 0 ? <span className="nav-badge">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
          </span>
          <span>Alerts</span>
        </Link>

        <Link to="/dashboard" className={`nav-item ${isActive("profile") ? "active" : ""}`}>
          <span className="nav-icon" aria-hidden="true">
            <UserIcon className="nav-svg" />
          </span>
          <span>Profile</span>
        </Link>
      </nav>
    </div>
  );
}

export default BottomNav;
