import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";

import LoginPage from "./pages/LoginPage";
import SignUpPage from "./pages/SignUpPage";
import VerificationPage from "./pages/VerificationPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import BrowsePage from "./pages/BrowsePage";
import DashboardPage from "./pages/DashboardPage";
import CreatePostPage from "./pages/CreatePostPage";
import PurchasesPage from "./pages/PurchasesPage";
import SearchPage from "./pages/SearchPage";
import OnboardingPage from "./pages/OnboardingPage";
import SuccessPage from "./pages/SuccessPage";
import CancelPage from "./pages/CancelPage";
import SchoolPage from "./pages/SchoolPage";
import ChapterPage from "./pages/ChapterPage";
import UserProfilePage from "./pages/UserProfilePage";
import PostDetailPage from "./pages/PostDetailPage";
import MessagesPage from "./pages/MessagesPage";
import NotificationsPage from "./pages/NotificationsPage";
import StripeAccountPage from "./pages/StripeAccountPage";
import AdminWorkspacePage from "./pages/AdminWorkspacePage";
import { NotificationProvider } from "./context/NotificationsContext";

export default function App() {
  return (
    <Router>
      <NotificationProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/verify" element={<VerificationPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/success" element={<SuccessPage />} />
          <Route path="/cancel" element={<CancelPage />} />

          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/browse" replace />} />
            <Route path="/browse" element={<BrowsePage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/create" element={<CreatePostPage />} />
            <Route path="/purchases" element={<PurchasesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:userId" element={<MessagesPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/account" element={<StripeAccountPage />} />
            <Route path="/reauth" element={<StripeAccountPage />} />
            <Route path="/admin" element={<AdminWorkspacePage />} />
            <Route path="/school/:id" element={<SchoolPage />} />
            <Route path="/chapter/:id" element={<ChapterPage />} />
            <Route path="/user/:id" element={<UserProfilePage />} />
            <Route path="/post/:id" element={<PostDetailPage />} />
            <Route path="*" element={<Navigate to="/browse" replace />} />
          </Route>
        </Routes>
      </NotificationProvider>
    </Router>
  );
}
