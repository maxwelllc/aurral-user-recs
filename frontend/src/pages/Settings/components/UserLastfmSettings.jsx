import { useState, useEffect } from "react";
import { Pencil, Check, X } from "lucide-react";

export function UserLastfmSettings({ user, onUpdate, showSuccess, showError }) {
  const [editing, setEditing] = useState(false);
  const [lastfmUsername, setLastfmUsername] = useState(user.lastfmUsername || "");
  const [lastfmDiscoveryPeriod, setLastfmDiscoveryPeriod] = useState(user.lastfmDiscoveryPeriod || "1month");
  const [saving, setSaving] = useState(false);
  const [originalValues, setOriginalValues] = useState({});

  useEffect(() => {
    setLastfmUsername(user.lastfmUsername || "");
    setLastfmDiscoveryPeriod(user.lastfmDiscoveryPeriod || "1month");
  }, [user]);

  const handleEdit = () => {
    setOriginalValues({
      lastfmUsername: lastfmUsername,
      lastfmDiscoveryPeriod: lastfmDiscoveryPeriod
    });
    setEditing(true);
  };

  const handleCancel = () => {
    setLastfmUsername(originalValues.lastfmUsername);
    setLastfmDiscoveryPeriod(originalValues.lastfmDiscoveryPeriod);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate({
        lastfmUsername: lastfmUsername || null,
        lastfmDiscoveryPeriod: lastfmDiscoveryPeriod || null
      });
      showSuccess("Last.fm settings updated");
      setEditing(false);
    } catch (err) {
      showError(
        err.response?.data?.error ||
          err.message ||
          "Failed to update Last.fm settings"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="p-6 rounded-lg space-y-4"
      style={{
        backgroundColor: "#1a1a1e",
        border: "1px solid #2a2a2e",
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3
          className="text-lg font-medium flex items-center"
          style={{ color: "#fff" }}
        >
          Last.fm Integration
        </h3>
        {!editing && (
          <button
            type="button"
            className="btn btn-secondary px-2 py-1"
            onClick={handleEdit}
            aria-label="Edit Last.fm settings"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: "#fff" }}
            >
              Last.fm Username
            </label>
            <input
              type="text"
              className="input w-full"
              placeholder="Your Last.fm username"
              value={lastfmUsername}
              onChange={(e) => setLastfmUsername(e.target.value)}
            />
            <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
              Your Last.fm username for personalized recommendations based on your listening history.
            </p>
          </div>

          <div>
            <label
              className="block text-sm font-medium mb-1"
              style={{ color: "#fff" }}
            >
              Discovery Period
            </label>
            <select
              className="input w-full"
              value={lastfmDiscoveryPeriod}
              onChange={(e) => setLastfmDiscoveryPeriod(e.target.value)}
            >
              <option value="none">None (Library only)</option>
              <option value="7day">Last 7 days</option>
              <option value="1month">This month</option>
              <option value="3month">3 months</option>
              <option value="6month">6 months</option>
              <option value="12month">12 months</option>
              <option value="overall">All time</option>
            </select>
            <p className="mt-1 text-xs" style={{ color: "#c1c1c3" }}>
              Which Last.fm listening period to use for discovery seeds.
            </p>
          </div>

          <div className="flex gap-2 justify-end">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancel}
              disabled={saving}
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                <>
                  <span className="loading loading-spinner loading-xs mr-1"></span>
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 mr-1" />
                  Save
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium" style={{ color: "#fff" }}>
              Username
            </div>
            <div style={{ color: "#c1c1c3" }}>
              {user.lastfmUsername || "Not set"}
            </div>
          </div>

          <div>
            <div className="text-sm font-medium" style={{ color: "#fff" }}>
              Discovery Period
            </div>
            <div style={{ color: "#c1c1c3" }}>
              {user.lastfmDiscoveryPeriod
                ? user.lastfmDiscoveryPeriod === "none"
                  ? "None (Library only)"
                  : user.lastfmDiscoveryPeriod === "7day"
                    ? "Last 7 days"
                    : user.lastfmDiscoveryPeriod === "1month"
                      ? "This month"
                      : user.lastfmDiscoveryPeriod === "3month"
                        ? "3 months"
                        : user.lastfmDiscoveryPeriod === "6month"
                          ? "6 months"
                          : user.lastfmDiscoveryPeriod === "12month"
                            ? "12 months"
                            : "All time"
                : "This month"}
            </div>
          </div>

          <p className="text-xs" style={{ color: "#c1c1c3" }}>
            Connect your Last.fm account to get personalized music recommendations based on your listening history.
          </p>
        </div>
      )}
    </div>
  );
}