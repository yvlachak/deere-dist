const fs = require('fs');

// Load dealers data
const dealers = JSON.parse(fs.readFileSync('dealers.json', 'utf8'));

// Rate limiting for Nominatim API (1 request per second)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Cache files
const CACHE_FILE = 'zip_coordinates_cache.json';
const PROGRESS_FILE = 'geocoding_progress.json';

// Load existing cache if it exists
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      console.log(`📁 Loaded existing cache with ${Object.keys(cache).length} ZIP codes`);
      return cache;
    }
  } catch (error) {
    console.warn('⚠️ Could not load cache file, starting fresh');
  }
  return {};
}

// Save cache to disk
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Save progress
function saveProgress(completed, total, successCount, failCount) {
  const progress = {
    completed,
    total,
    successCount,
    failCount,
    timestamp: new Date().toISOString(),
    percentage: Math.round((completed / total) * 100)
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function geocodeZip(zip) {
  if (!zip) return null;
  
  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&country=USA&format=json&limit=1`;
    const response = await fetch(url, { 
      headers: { 
        'Accept': 'application/json',
        'User-Agent': 'DeereDealersMap/1.0' // Required by Nominatim
      } 
    });
    
    if (!response.ok) {
      console.warn(`Failed to geocode ${zip}: HTTP ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
      return { 
        lat: parseFloat(data[0].lat), 
        lon: parseFloat(data[0].lon) 
      };
    }
    
    console.warn(`No coordinates found for ZIP ${zip}`);
    return null;
  } catch (error) {
    console.error(`Error geocoding ${zip}:`, error.message);
    return null;
  }
}

async function geocodeAllDealers() {
  // Get unique ZIP codes
  const uniqueZips = [...new Set(dealers.map(d => d.zip).filter(Boolean))];
  console.log(`Found ${uniqueZips.length} unique ZIP codes from ${dealers.length} dealers`);
  console.log(`This will take approximately ${Math.ceil(uniqueZips.length / 60)} minutes (1 request per second)`);
  
  // Load existing cache
  const zipToCoords = loadCache();
  
  // Find which ZIP codes still need geocoding
  const remainingZips = uniqueZips.filter(zip => !zipToCoords[zip]);
  const alreadyCached = uniqueZips.length - remainingZips.length;
  
  console.log(`📊 Progress: ${alreadyCached} already cached, ${remainingZips.length} remaining`);
  
  if (remainingZips.length === 0) {
    console.log('🎉 All ZIP codes already geocoded!');
  } else {
    console.log(`🔄 Starting geocoding of ${remainingZips.length} remaining ZIP codes...`);
  }
  
  let successCount = Object.values(zipToCoords).length;
  let failCount = 0;
  let processedCount = alreadyCached;
  
  // Geocode remaining ZIP codes
  for (let i = 0; i < remainingZips.length; i++) {
    const zip = remainingZips[i];
    const overallProgress = processedCount + 1;
    
    console.log(`Geocoding ${overallProgress}/${uniqueZips.length}: ${zip}`);
    
    const coords = await geocodeZip(zip);
    if (coords) {
      zipToCoords[zip] = coords;
      successCount++;
    } else {
      failCount++;
    }
    
    processedCount++;
    
    // Save progress every 10 ZIP codes
    if (processedCount % 10 === 0) {
      saveCache(zipToCoords);
      saveProgress(processedCount, uniqueZips.length, successCount, failCount);
      console.log(`💾 Saved progress: ${processedCount}/${uniqueZips.length} (${Math.round((processedCount/uniqueZips.length)*100)}%)`);
    }
    
    // Rate limiting: 1 request per second
    if (i < remainingZips.length - 1) {
      await delay(1000);
    }
  }
  
  // Final save
  saveCache(zipToCoords);
  saveProgress(processedCount, uniqueZips.length, successCount, failCount);
  
  console.log(`\nGeocoding complete:`);
  console.log(`✅ Success: ${successCount}`);
  console.log(`❌ Failed: ${failCount}`);
  
  // Add coordinates to dealers data
  const dealersWithCoords = dealers.map(dealer => ({
    ...dealer,
    coordinates: zipToCoords[dealer.zip] || null
  }));
  
  // Save the final result
  fs.writeFileSync('dealers_with_coords.json', JSON.stringify(dealersWithCoords, null, 2));
  console.log(`\n💾 Saved dealers_with_coords.json with ${dealersWithCoords.length} dealers`);
  
  // Also save just the ZIP to coordinates mapping for reference
  fs.writeFileSync('zip_coordinates.json', JSON.stringify(zipToCoords, null, 2));
  console.log(`💾 Saved zip_coordinates.json with ${Object.keys(zipToCoords).length} ZIP codes`);
  
  // Clean up progress file
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
  }
  
  return dealersWithCoords;
}

// Run the geocoding
console.log('🚀 Starting geocoding process with caching...');
console.log('📁 Progress will be saved every 10 ZIP codes');
console.log('🔄 Script can be resumed if interrupted');
console.log('Press Ctrl+C to cancel\n');

geocodeAllDealers()
  .then(() => {
    console.log('\n🎉 Geocoding complete! You can now use dealers_with_coords.json');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Geocoding failed:', error);
    console.log('💡 You can resume by running the script again - it will continue from where it left off');
    process.exit(1);
  });
