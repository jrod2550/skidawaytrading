"""Weather data for Kalshi climate/weather market analysis.

Uses Open-Meteo API (free, no key required) for:
- Current conditions worldwide
- 7-day forecasts
- Historical temperature data
- Extreme weather alerts
"""

import logging
import httpx

logger = logging.getLogger(__name__)

OPEN_METEO_BASE = "https://api.open-meteo.com/v1"

# Key locations for weather markets
LOCATIONS = {
    "global_avg": {"lat": 0, "lon": 0, "name": "Global (equator reference)"},
    "new_york": {"lat": 40.71, "lon": -74.01, "name": "New York"},
    "los_angeles": {"lat": 34.05, "lon": -118.24, "name": "Los Angeles"},
    "chicago": {"lat": 41.88, "lon": -87.63, "name": "Chicago"},
    "miami": {"lat": 25.76, "lon": -80.19, "name": "Miami"},
    "london": {"lat": 51.51, "lon": -0.13, "name": "London"},
    "tokyo": {"lat": 35.68, "lon": 139.69, "name": "Tokyo"},
    "savannah": {"lat": 32.08, "lon": -81.10, "name": "Savannah, GA"},
}


class WeatherClient:
    """Free weather data from Open-Meteo API."""

    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=15.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def get_current_weather(self, cities: list[str] | None = None) -> list[dict]:
        """Get current weather for key cities."""
        results = []
        locations = {k: v for k, v in LOCATIONS.items() if k in (cities or LOCATIONS.keys())}

        for key, loc in locations.items():
            try:
                resp = await self._client.get(
                    f"{OPEN_METEO_BASE}/forecast",
                    params={
                        "latitude": loc["lat"],
                        "longitude": loc["lon"],
                        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
                        "temperature_unit": "fahrenheit",
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    current = data.get("current", {})
                    results.append({
                        "city": loc["name"],
                        "temp_f": current.get("temperature_2m"),
                        "humidity": current.get("relative_humidity_2m"),
                        "wind_mph": current.get("wind_speed_10m"),
                        "weather_code": current.get("weather_code"),
                    })
            except Exception:
                pass

        return results

    async def get_forecast(self, lat: float = 40.71, lon: float = -74.01, days: int = 7) -> dict:
        """Get weather forecast."""
        try:
            resp = await self._client.get(
                f"{OPEN_METEO_BASE}/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code",
                    "temperature_unit": "fahrenheit",
                    "forecast_days": days,
                },
            )
            if resp.status_code == 200:
                return resp.json().get("daily", {})
        except Exception:
            pass
        return {}

    async def get_global_temperature_anomaly(self) -> dict:
        """Get recent global temperature data for climate market analysis."""
        try:
            # Use historical weather API for temperature trends
            from datetime import date, timedelta
            end = date.today()
            start = end - timedelta(days=30)

            resp = await self._client.get(
                f"{OPEN_METEO_BASE}/forecast",
                params={
                    "latitude": "0,40.71,51.51,35.68,-33.87",  # Equator, NYC, London, Tokyo, Sydney
                    "longitude": "0,-74.01,-0.13,139.69,151.21",
                    "daily": "temperature_2m_max,temperature_2m_min",
                    "temperature_unit": "celsius",
                    "past_days": 30,
                    "forecast_days": 7,
                },
            )
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return {}

    async def get_hurricane_season_data(self) -> dict:
        """Get tropical weather data relevant to hurricane markets."""
        try:
            # Caribbean/Gulf of Mexico conditions
            resp = await self._client.get(
                f"{OPEN_METEO_BASE}/forecast",
                params={
                    "latitude": "20,25,15",
                    "longitude": "-80,-90,-60",
                    "current": "temperature_2m,wind_speed_10m,pressure_msl",
                    "daily": "temperature_2m_max,wind_speed_10m_max,precipitation_sum",
                    "temperature_unit": "fahrenheit",
                    "forecast_days": 7,
                },
            )
            if resp.status_code == 200:
                return resp.json()
        except Exception:
            pass
        return {}

    async def get_weather_summary(self) -> dict:
        """Get a comprehensive weather summary for AI analysis."""
        import asyncio

        current, forecast_ny, forecast_la, global_temp = await asyncio.gather(
            self.get_current_weather(["new_york", "los_angeles", "chicago", "miami", "london"]),
            self.get_forecast(40.71, -74.01, 7),
            self.get_forecast(34.05, -118.24, 7),
            self.get_global_temperature_anomaly(),
        )

        return {
            "current_conditions": current,
            "ny_7day_forecast": forecast_ny,
            "la_7day_forecast": forecast_la,
            "global_temperature_data": global_temp,
            "data_source": "Open-Meteo API (free, real-time)",
        }
