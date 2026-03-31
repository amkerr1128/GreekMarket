import { useEffect, useMemo, useState } from "react";
import API from "../api/axios";
import Avatar from "./Avatar";
import FancySelect from "./FancySelect";
import { getAuthErrorMessage, isNetworkFailure } from "../utils/authErrors";
import { getChapterLetterFallback } from "../utils/chapterLetters";
import { applyProfileOverride, setProfileOverride } from "../utils/profilePreferences";
import { saveAccountSession } from "../utils/savedAccounts";
import "../styles/ProfileEditorPanel.css";

const chapterAdminRoles = new Set(["admin", "administrator", "officer", "president", "vp", "captain"]);

export default function ProfileEditorPanel({
  user,
  onSaved,
  className = "",
  title = "Edit profile",
  description = "Update your account details and preview your changes before saving.",
}) {
  const mergedUser = useMemo(() => applyProfileOverride(user), [user]);
  const [draft, setDraft] = useState({
    first_name: "",
    last_name: "",
    handle: "",
    school_id: "",
  });
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [removePhoto, setRemovePhoto] = useState(false);
  const [chapterPhotoFile, setChapterPhotoFile] = useState(null);
  const [chapterPhotoPreview, setChapterPhotoPreview] = useState("");
  const [removeChapterPhoto, setRemoveChapterPhoto] = useState(false);
  const [schools, setSchools] = useState([]);
  const [loadingSchools, setLoadingSchools] = useState(true);
  const [schoolError, setSchoolError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!mergedUser) return;

    setDraft({
      first_name: mergedUser.first_name || "",
      last_name: mergedUser.last_name || "",
      handle: mergedUser.handle || "",
      school_id: mergedUser.school_id ? String(mergedUser.school_id) : "",
    });
    setPhotoFile(null);
    setPhotoPreview("");
    setRemovePhoto(false);
    setChapterPhotoFile(null);
    setChapterPhotoPreview("");
    setRemoveChapterPhoto(false);
    setStatus("");
    setError("");
  }, [
    mergedUser,
    mergedUser?.user_id,
    mergedUser?.first_name,
    mergedUser?.last_name,
    mergedUser?.handle,
    mergedUser?.school_id,
    mergedUser?.profile_picture_url,
    mergedUser?.chapter_profile_picture_url,
  ]);

  useEffect(() => {
    let active = true;

    (async () => {
      setLoadingSchools(true);
      setSchoolError("");
      try {
        const { data } = await API.get("/schools");
        if (!active) return;
        setSchools(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!active) return;
        setSchools([]);
        setSchoolError(
          isNetworkFailure(err)
            ? "School options could not be loaded right now. The backend may be offline or blocked by CORS."
            : err?.response?.data?.error || "Could not load school options."
        );
      } finally {
        if (active) setLoadingSchools(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!photoPreview) return undefined;
    return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  useEffect(() => {
    if (!chapterPhotoPreview) return undefined;
    return () => URL.revokeObjectURL(chapterPhotoPreview);
  }, [chapterPhotoPreview]);

  const schoolOptions = useMemo(
    () =>
      schools.map((school) => ({
        value: String(school.id),
        label: school.name,
        meta: school.domain || "Campus community",
      })),
    [schools]
  );

  const selectedSchool = useMemo(
    () => schools.find((school) => String(school.id) === String(draft.school_id)) || null,
    [draft.school_id, schools]
  );

  const actualProfilePictureUrl = mergedUser?.has_profile_picture ? mergedUser.profile_picture_url || "" : "";
  const chapterFallback = getChapterLetterFallback(mergedUser?.chapter_name || "", 3);
  const chapterCanManage =
    Boolean(mergedUser?.can_manage_chapter_branding) ||
    chapterAdminRoles.has(String(mergedUser?.chapter_role || "").toLowerCase());
  const chapterPreviewUrl = removeChapterPhoto
    ? ""
    : chapterPhotoPreview || mergedUser?.chapter_profile_picture_url || "";

  const previewUser = useMemo(() => {
    const profile_picture_url = removePhoto ? "" : photoPreview || actualProfilePictureUrl;

    return {
      ...mergedUser,
      ...draft,
      profile_picture_url,
    };
  }, [actualProfilePictureUrl, draft, mergedUser, photoPreview, removePhoto]);

  async function handleSave(event) {
    event.preventDefault();
    setError("");
    setStatus("");

    if (!mergedUser?.user_id) {
      setError("No profile loaded yet.");
      return;
    }

    setSaving(true);
    try {
      const nextSchoolId = draft.school_id ? Number(draft.school_id) : null;
      const payload = {
        school_id: nextSchoolId,
        first_name: draft.first_name.trim(),
        last_name: draft.last_name.trim(),
        handle: draft.handle.trim(),
      };

      const { data: profileData } = await API.put("/me", payload);
      let nextUser = {
        ...mergedUser,
        ...profileData,
        chapter: mergedUser.chapter,
        chapter_id: mergedUser.chapter_id,
        chapter_name: mergedUser.chapter_name,
        chapter_role: mergedUser.chapter_role,
        chapter_profile_picture_url: mergedUser.chapter_profile_picture_url || "",
        can_manage_chapter_branding: mergedUser.can_manage_chapter_branding,
        school_id: nextSchoolId,
        school_name: selectedSchool?.name || profileData?.school_name || mergedUser.school_name || "",
      };

      if (photoFile) {
        const formData = new FormData();
        formData.append("image", photoFile);
        const { data } = await API.post("/me/profile-picture", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        nextUser = {
          ...nextUser,
          ...(data?.user || {}),
          chapter: mergedUser.chapter,
          chapter_id: mergedUser.chapter_id,
          chapter_name: mergedUser.chapter_name,
          chapter_role: mergedUser.chapter_role,
          chapter_profile_picture_url: mergedUser.chapter_profile_picture_url || "",
          can_manage_chapter_branding: mergedUser.can_manage_chapter_branding,
        };
      } else if (removePhoto && actualProfilePictureUrl) {
        const { data } = await API.delete("/me/profile-picture");
        nextUser = {
          ...nextUser,
          ...(data?.user || {}),
          chapter: mergedUser.chapter,
          chapter_id: mergedUser.chapter_id,
          chapter_name: mergedUser.chapter_name,
          chapter_role: mergedUser.chapter_role,
          chapter_profile_picture_url: mergedUser.chapter_profile_picture_url || "",
          can_manage_chapter_branding: mergedUser.can_manage_chapter_branding,
        };
      }

      if (chapterCanManage && mergedUser?.chapter_id) {
        if (chapterPhotoFile) {
          const formData = new FormData();
          formData.append("image", chapterPhotoFile);
          const { data } = await API.post(`/chapters/${mergedUser.chapter_id}/profile-picture`, formData, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          nextUser = {
            ...nextUser,
            chapter_profile_picture_url: data?.chapter?.profile_picture_url || "",
          };
        } else if (removeChapterPhoto && mergedUser?.chapter_profile_picture_url) {
          await API.delete(`/chapters/${mergedUser.chapter_id}/profile-picture`);
          nextUser = {
            ...nextUser,
            chapter_profile_picture_url: "",
          };
        }
      }

      setProfileOverride(mergedUser.user_id, {
        first_name: nextUser.first_name,
        last_name: nextUser.last_name,
        handle: nextUser.handle,
        school_id: nextUser.school_id,
        school_name: nextUser.school_name,
        profile_picture_url: nextUser.profile_picture_url || "",
        chapter_profile_picture_url: nextUser.chapter_profile_picture_url || "",
      });
      saveAccountSession({
        token: localStorage.getItem("token"),
        user: nextUser,
        email: nextUser.email,
      });

      onSaved?.(nextUser);
      setDraft({
        first_name: nextUser.first_name || "",
        last_name: nextUser.last_name || "",
        handle: nextUser.handle || "",
        school_id: nextUser.school_id ? String(nextUser.school_id) : "",
      });
      setPhotoFile(null);
      setPhotoPreview("");
      setRemovePhoto(false);
      setChapterPhotoFile(null);
      setChapterPhotoPreview("");
      setRemoveChapterPhoto(false);
      setStatus("Profile saved.");
    } catch (err) {
      setError(getAuthErrorMessage(err, "Could not save this profile right now."));
    } finally {
      setSaving(false);
    }
  }

  function handlePhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setPhotoFile(file);
    setRemovePhoto(false);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function handleClearPhoto() {
    setPhotoFile(null);
    setPhotoPreview("");
    setRemovePhoto(true);
  }

  function handleChapterPhotoChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setChapterPhotoFile(file);
    setRemoveChapterPhoto(false);
    setChapterPhotoPreview(URL.createObjectURL(file));
  }

  function handleClearChapterPhoto() {
    setChapterPhotoFile(null);
    setChapterPhotoPreview("");
    setRemoveChapterPhoto(true);
  }

  return (
    <section className={`profile-editor card ${className}`.trim()}>
      <div className="profile-editor-head">
        <div>
          <p className="eyebrow">Profile settings</p>
          <h3>{title}</h3>
          <p className="muted">{description}</p>
        </div>
        {status ? <span className="editor-status success">{status}</span> : null}
      </div>

      <form className="profile-editor-grid" onSubmit={handleSave}>
        <div className="profile-editor-visual">
          <Avatar
            size="xl"
            className="profile-editor-avatar"
            user={previewUser}
          />
          <div className="profile-editor-visual-copy">
            <strong>{previewUser.first_name} {previewUser.last_name}</strong>
            <span>@{previewUser.handle}</span>
            <span>{previewUser.school_name || "School not set"}</span>
          </div>
          <div className="profile-photo-actions">
            <label className="photo-action primary">
              Upload photo
              <input type="file" accept="image/*" onChange={handlePhotoChange} />
            </label>
            <button type="button" className="photo-action" onClick={handleClearPhoto}>
              Remove photo
            </button>
          </div>
          <p className="field-note">
            New photos are previewed immediately and saved to your real account when you submit.
          </p>
        </div>

        <div className="profile-editor-fields">
          <label className="editor-field">
            <span>First name</span>
            <input
              type="text"
              value={draft.first_name}
              onChange={(event) => setDraft({ ...draft, first_name: event.target.value })}
              placeholder="First name"
            />
          </label>

          <label className="editor-field">
            <span>Last name</span>
            <input
              type="text"
              value={draft.last_name}
              onChange={(event) => setDraft({ ...draft, last_name: event.target.value })}
              placeholder="Last name"
            />
          </label>

          <label className="editor-field">
            <span>Handle</span>
            <input
              type="text"
              value={draft.handle}
              onChange={(event) => setDraft({ ...draft, handle: event.target.value })}
              placeholder="@handle"
            />
          </label>

          <label className="editor-field">
            <span>School</span>
            <FancySelect
              value={draft.school_id}
              onChange={(schoolId) => setDraft({ ...draft, school_id: schoolId })}
              disabled={loadingSchools}
              ariaLabel="Choose your school"
              placeholder={loadingSchools ? "Loading schools..." : "Choose your school"}
              options={schoolOptions}
            />
            {schoolError ? <p className="field-note error">{schoolError}</p> : null}
          </label>

          <div className="editor-actions">
            <button type="submit" className="primary-action" disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => {
                setDraft({
                  first_name: mergedUser?.first_name || "",
                  last_name: mergedUser?.last_name || "",
                  handle: mergedUser?.handle || "",
                  school_id: mergedUser?.school_id ? String(mergedUser.school_id) : "",
                });
                setPhotoFile(null);
                setPhotoPreview("");
                setRemovePhoto(false);
                setChapterPhotoFile(null);
                setChapterPhotoPreview("");
                setRemoveChapterPhoto(false);
                setError("");
                setStatus("");
              }}
            >
              Reset
            </button>
          </div>

          {error ? <p className="editor-status error">{error}</p> : null}
          {loadingSchools && !schoolError ? (
            <p className="editor-status">Loading school options...</p>
          ) : null}

          {mergedUser?.chapter_name ? (
            <div className="chapter-branding-block">
              <div className="section-head">
                <div>
                  <h4>Chapter branding</h4>
                  <p className="muted">
                    {chapterCanManage
                      ? "Update the chapter image that appears on chapter search cards and the chapter profile."
                      : "Only chapter admins can update the chapter image."}
                  </p>
                </div>
                <span className={`brand-chip ${chapterCanManage ? "active" : ""}`}>
                  {chapterCanManage ? "Admin" : "Locked"}
                </span>
              </div>
              <div className="chapter-branding-shell">
                <div className="branding-card branding-preview">
                  <Avatar
                    size="lg"
                    className="chapter-brand-avatar"
                    fallback={chapterFallback || "CP"}
                    user={{
                      handle: mergedUser.chapter_name,
                      profile_picture_url: chapterPreviewUrl,
                    }}
                  />
                  <div className="branding-copy">
                    <strong>{mergedUser.chapter_name}</strong>
                    <span>
                      {chapterPreviewUrl
                        ? "Current chapter image preview."
                        : "No chapter image uploaded yet."}
                    </span>
                  </div>
                </div>
                {chapterCanManage ? (
                  <div className="chapter-brand-actions">
                    <label className="photo-action primary">
                      Upload chapter image
                      <input type="file" accept="image/*" onChange={handleChapterPhotoChange} />
                    </label>
                    <button type="button" className="photo-action" onClick={handleClearChapterPhoto}>
                      Remove chapter image
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </form>
    </section>
  );
}
