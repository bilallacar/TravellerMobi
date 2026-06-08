// js/state.js

export const state = {
    activeUser: null,
    userProfile: null,
    isAdmin: false,
    tripsList: [],
    expensesList: [],
    categoriesList: [], // Dinamik kategori listesi
    memoriesList: [],
    activeTripId: null,
    currentGalleryTab: 'all',
    exchangeRates: {},
    selectedPhotoFile: null,
    tempTripParticipants: [],
    photoBlobUrls: {},
    pendingPhotoLoads: new Set()
};

export const fallbackRates = {
    TRY: 32.50,
    EUR: 0.92,
    USD: 1.00,
    GBP: 0.79,
    JPY: 157.00
};
