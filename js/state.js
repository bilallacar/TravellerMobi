// js/state.js

export const state = {
    activeUser: null,
    userProfile: null,
    isAdmin: false,
    tripsList: [],
    expensesList: [],
    categoriesList: [], // Dinamik kategori listesi
    memoriesList: [],
    placesList: [],
    activePlaceFilter: 'all', // 'all', 'planned', 'visited', 'hotel', 'museum', 'food'
    selectedPlaceForEdit: null,
    activeTripId: null,
    currentGalleryTab: 'all',
    exchangeRates: {},
    exchangeRatesMeta: { source: 'fallback', updatedAt: null },
    selectedPhotoFile: null,
    tempTripParticipants: [],
    photoBlobUrls: {},
    pendingPhotoLoads: new Set()
};

export const fallbackRates = {
    TRY: 50.31,
    EUR: 0.9035,
    USD: 1.00,
    GBP: 0.755,
    JPY: 159.80
};
