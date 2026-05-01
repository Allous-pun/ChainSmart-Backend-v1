// OpenStreetMap Nominatim geocoding (free, no API key)
const geocodeAddress = async (address, city, region, country = 'Kenya') => {
  try {
    // Build the search query
    let searchQuery = '';
    if (address) searchQuery += `${address}, `;
    if (city) searchQuery += `${city}, `;
    if (region) searchQuery += `${region}, `;
    searchQuery += country;
    
    // Encode the query for URL
    const encodedQuery = encodeURIComponent(searchQuery);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1`;
    
    // Make request with proper headers (required by Nominatim)
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ChainSmart/1.0',
        'Accept-Language': 'en'
      }
    });
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
        formattedAddress: data[0].display_name
      };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

// Geocode from full address string
const geocodeFullAddress = async (fullAddress) => {
  try {
    const encodedQuery = encodeURIComponent(fullAddress);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ChainSmart/1.0',
        'Accept-Language': 'en'
      }
    });
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
        formattedAddress: data[0].display_name
      };
    }
    
    return null;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
};

// Reverse geocode (get address from coordinates)
const reverseGeocode = async (lat, lon) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ChainSmart/1.0',
        'Accept-Language': 'en'
      }
    });
    
    const data = await response.json();
    
    if (data && data.display_name) {
      return {
        formattedAddress: data.display_name,
        address: data.address
      };
    }
    
    return null;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return null;
  }
};

// Calculate driving distance between two coordinates using OSRM
const calculateDrivingDistance = async (lat1, lon1, lat2, lon2) => {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      return {
        distanceKm: data.routes[0].distance / 1000, // meters to km
        durationMin: data.routes[0].duration / 60, // seconds to minutes
        durationHours: data.routes[0].duration / 3600 // seconds to hours
      };
    }
    return null;
  } catch (error) {
    console.error('OSRM distance calculation error:', error);
    return null;
  }
};

// Calculate driving distance with full route geometry
const calculateRoute = async (lat1, lon1, lat2, lon2) => {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=polyline`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      return {
        distanceKm: data.routes[0].distance / 1000,
        durationMin: data.routes[0].duration / 60,
        durationHours: data.routes[0].duration / 3600,
        geometry: data.routes[0].geometry, // Polyline encoded route
        weight: data.routes[0].weight
      };
    }
    return null;
  } catch (error) {
    console.error('OSRM route calculation error:', error);
    return null;
  }
};

// Calculate distance matrix for multiple points
const calculateDistanceMatrix = async (origins, destinations) => {
  try {
    // Format: lon,lat;lon,lat
    const originString = origins.map(p => `${p.lon},${p.lat}`).join(';');
    const destinationString = destinations.map(p => `${p.lon},${p.lat}`).join(';');
    
    const url = `https://router.project-osrm.org/table/v1/driving/${originString};${destinationString}`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code === 'Ok') {
      const matrix = [];
      for (let i = 0; i < origins.length; i++) {
        matrix[i] = [];
        for (let j = 0; j < destinations.length; j++) {
          const index = i * destinations.length + j;
          matrix[i][j] = {
            distanceKm: data.distances ? data.distances[i][j] / 1000 : null,
            durationMin: data.durations ? data.durations[i][j] / 60 : null
          };
        }
      }
      return matrix;
    }
    return null;
  } catch (error) {
    console.error('OSRM distance matrix error:', error);
    return null;
  }
};

module.exports = {
  geocodeAddress,
  geocodeFullAddress,
  reverseGeocode,
  calculateDrivingDistance,
  calculateRoute,
  calculateDistanceMatrix
};