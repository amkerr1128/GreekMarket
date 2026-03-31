import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../api/axios";
import FancySelect from "../components/FancySelect";
import { useNotifications } from "../context/NotificationsContext";
import "../styles/CreatePostPage.css";

const TYPES = ["apparel", "accessories", "stickers", "tickets", "other"];
const TYPE_OPTIONS = TYPES.map((item) => ({
  value: item,
  label: item[0].toUpperCase() + item.slice(1),
  meta: "Choose the best fit for your listing",
}));

export default function CreatePostPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);
  const [loadingMe, setLoadingMe] = useState(true);
  const [type, setType] = useState("apparel");
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const { pushNotification } = useNotifications();

  const canSubmit = useMemo(() => {
    if (!title.trim()) return false;
    if (!type) return false;
    if (price && Number.isNaN(Number(price))) return false;
    return true;
  }, [title, type, price]);
  const hasVerifiedContact = Boolean(
    me?.has_verified_contact || me?.contact_verification?.has_verified_contact
  );

  useEffect(() => {
    (async () => {
      try {
        const { data } = await API.get("/me");
        setMe(data);
      } catch (err) {
        if (err?.response?.status === 401) {
          localStorage.removeItem("token");
          navigate("/login");
          return;
        }
        setMe(null);
      } finally {
        setLoadingMe(false);
      }
    })();
  }, [navigate]);

  useEffect(() => {
    const previews = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      name: file.name,
    }));

    setFilePreviews(previews);

    return () => {
      previews.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [files]);

  function addFiles(nextFiles) {
    setFiles((current) => {
      const existing = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      const additions = nextFiles.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`));
      return [...current, ...additions];
    });
  }

  function handleFilesChange(event) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function removeFile(index) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function setCoverImage(index) {
    setFiles((current) => {
      if (index <= 0 || index >= current.length) return current;
      const next = [...current];
      const [picked] = next.splice(index, 1);
      next.unshift(picked);
      return next;
    });
  }

  function clearFiles() {
    setFiles([]);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setOkMsg("");

    if (!me?.school_id) {
      setError("Join your school before creating a post.");
      return;
    }

    if (!canSubmit) {
      setError("Please complete the required fields.");
      return;
    }

    setSubmitting(true);
    try {
      let image_urls = [];
      if (files?.length) {
        const formData = new FormData();
        files.forEach((file) => {
          formData.append("images", file);
        });
        const response = await API.post("/upload-image", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        image_urls = Array.isArray(response?.data?.urls)
          ? response.data.urls.filter(Boolean)
          : [response?.data?.url].filter(Boolean);
      }

      const payload = {
        type,
        title: title.trim(),
        description: description.trim() || null,
        price: price ? Number(price) : null,
        visibility: "public",
        image_urls,
      };

      const { data } = await API.post("/posts", payload);
      setOkMsg("Post created.");
      pushNotification({
        type: "post",
        title: "Listing published",
        body: title.trim(),
        targetUrl: data?.post_id ? `/post/${data.post_id}` : "/browse",
        sourceKey: `post:${data?.post_id || Date.now()}`,
      });

      setTimeout(() => {
        navigate(data?.post_id ? `/post/${data.post_id}` : "/browse");
      }, 350);

      setTitle("");
      setPrice("");
      setDescription("");
      setFiles([]);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Could not create your post.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingMe) {
    return (
      <div className="create-post-page">
        <div className="create-hero card">
          <p className="eyebrow">Create listing</p>
          <h2>Preparing your post editor</h2>
          <p className="muted">Loading your profile and school membership...</p>
        </div>
      </div>
    );
  }

  if (!me?.school_id) {
    return (
      <div className="create-post-page">
        <section className="create-hero card">
          <p className="eyebrow">Create listing</p>
          <h2>Join a school to start posting</h2>
          <p className="muted">
            You need to be part of a school community before you can publish listings.
          </p>
          <div className="create-actions">
            <Link to="/search?q=" className="action primary">
              Find my school
            </Link>
            <Link to="/browse" className="action">
              Browse posts
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (!hasVerifiedContact) {
    return (
      <div className="create-post-page">
        <section className="create-hero card">
          <p className="eyebrow">Create listing</p>
          <h2>Verify your contact before listing items</h2>
          <p className="muted">
            You can browse, follow schools and chapters, and finish setup first. A verified email or phone is required before the marketplace lets you publish listings.
          </p>
          <div className="create-actions">
            <Link to="/verify" className="action primary">
              Verify account
            </Link>
            <Link to="/browse" className="action">
              Browse posts
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="create-post-page">
      <section className="create-hero card">
        <div>
          <p className="eyebrow">Create listing</p>
          <h1>Sell something with a cleaner flow.</h1>
          <p className="muted">
            Keep it simple: a clear title, a fair price, and a few photos make the post feel
            immediately credible.
          </p>
        </div>
        <div className="hero-badge">
          <span>Verified seller flow active</span>
        </div>
      </section>

      <form className="create-grid" onSubmit={handleSubmit}>
        <section className="create-card card">
          <div className="field">
            <span>Category</span>
            <FancySelect
              value={type}
              onChange={setType}
              ariaLabel="Listing category"
              options={TYPE_OPTIONS}
            />
          </div>

          <div className="field">
            <span>Title</span>
            <input
              type="text"
              placeholder="What are you selling?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <span>Price (USD)</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 25"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </div>

          <div className="field">
            <span>Description</span>
            <textarea
              rows={6}
              placeholder="Condition, sizing, pickup details, and anything else a buyer should know."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="field">
            <span>Photos</span>
            <label className="upload-field">
              <span className="upload-copy">Choose photos</span>
              <span className="upload-meta">
                {files.length ? `${files.length} photo${files.length === 1 ? "" : "s"} selected` : "PNG, JPG, WEBP"}
              </span>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFilesChange}
              />
            </label>
            <p className="helper">
              {files.length
                ? "Drag-in replacements by picking more files, then choose the cover image from the previews below."
                : "Add multiple clear images so buyers can see the item from more than one angle."}
            </p>
            {filePreviews.length ? (
              <div className="media-previews">
                <div className="media-previews-head">
                  <span>Photo order</span>
                  <button type="button" className="media-clear" onClick={clearFiles}>
                    Clear all
                  </button>
                </div>
                <div className="media-preview-grid">
                  {filePreviews.map((preview, index) => (
                    <div key={`${preview.name}-${index}`} className="media-preview-card">
                      <img src={preview.url} alt={preview.name} className="media-preview-image" />
                      {index === 0 ? <span className="media-cover-chip">Cover</span> : null}
                      <div className="media-preview-copy">
                        <strong>{preview.name}</strong>
                        <span>{Math.round(preview.file.size / 1024)} KB</span>
                      </div>
                      <div className="media-preview-actions">
                        {index > 0 ? (
                          <button type="button" className="media-mini-btn" onClick={() => setCoverImage(index)}>
                            Set cover
                          </button>
                        ) : null}
                        <button type="button" className="media-mini-btn danger" onClick={() => removeFile(index)}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <button className="primary-action" type="submit" disabled={!canSubmit || submitting}>
            {submitting ? "Creating..." : "Create post"}
          </button>

          {error ? <p className="message error">{error}</p> : null}
          {okMsg ? <p className="message success">{okMsg}</p> : null}
        </section>

        <aside className="create-side card">
          <h3>Tips for a strong post</h3>
          <ul>
            <li>Use a short title buyers can scan quickly.</li>
            <li>Set a price that feels easy to compare.</li>
            <li>Add clean photos with good lighting.</li>
            <li>Describe size, condition, and pickup notes.</li>
          </ul>
        </aside>
      </form>
    </div>
  );
}
