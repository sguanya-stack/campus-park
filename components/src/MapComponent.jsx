import { useEffect, useMemo, useState } from 'react'
import { GoogleMap, HeatmapLayerF, useJsApiLoader } from '@react-google-maps/api'

const MAP_CENTER = { lat: 47.6205, lng: -122.3493 }
const MAP_CONTAINER_STYLE = { width: '100%', height: '520px' }
const HEATMAP_GRADIENT = [
  'rgba(0, 255, 0, 0)',
  'rgba(0, 255, 0, 0.6)',
  'rgba(255, 255, 0, 0.7)',
  'rgba(255, 128, 0, 0.8)',
  'rgba(255, 0, 0, 0.95)'
]

function toGoogleLatLng(points) {
  if (!window.google?.maps) return []
  return points.map((log) => new window.google.maps.LatLng(log.lat, log.lng))
}

export default function MapComponent() {
  const [searchData, setSearchData] = useState([])
  const [showHeatmap, setShowHeatmap] = useState(true)

  const { isLoaded } = useJsApiLoader({
    id: 'campuspark-gmaps',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
    libraries: ['visualization']
  })

  useEffect(() => {
    let isMounted = true

    const fetchHeatmap = async () => {
      try {
        const res = await fetch('/api/analytics/heatmap')
        if (!res.ok) return
        const data = await res.json()
        if (isMounted) setSearchData(Array.isArray(data) ? data : [])
      } catch {
        // Keep last known data if fetch fails.
      }
    }

    fetchHeatmap()
    const intervalId = setInterval(fetchHeatmap, 60 * 1000)

    return () => {
      isMounted = false
      clearInterval(intervalId)
    }
  }, [])

  const googleData = useMemo(() => toGoogleLatLng(searchData), [searchData, isLoaded])

  return (
    <section className="map-shell">
      <header className="map-header">
        <div>
          <p className="map-eyebrow">Live Analytics</p>
          <h2>CampusPark Popularity</h2>
          <p className="map-sub">
            Real-time demand from the last 12 hours, refreshed every minute.
          </p>
        </div>
        <button
          className={`heatmap-toggle ${showHeatmap ? 'active' : ''}`}
          type="button"
          onClick={() => setShowHeatmap((prev) => !prev)}
          aria-pressed={showHeatmap}
        >
          <span className="toggle-knob" />
          <span className="toggle-text">Popularity Heatmap</span>
        </button>
      </header>

      <div className="map-card">
        {isLoaded ? (
          <GoogleMap mapContainerStyle={MAP_CONTAINER_STYLE} center={MAP_CENTER} zoom={14}>
            {showHeatmap && (
              <HeatmapLayerF
                data={googleData}
                options={{
                  radius: 35,
                  opacity: 0.7,
                  gradient: HEATMAP_GRADIENT
                }}
              />
            )}
          </GoogleMap>
        ) : (
          <div className="map-loading">Loading map…</div>
        )}
      </div>
    </section>
  )
}
