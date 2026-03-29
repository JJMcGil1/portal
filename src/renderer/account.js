// Account tile + settings modal
import { PiX } from 'react-icons/pi';
import { renderIcon } from './icon.js';
import { state } from './state.js';

let profile = { first_name: '', last_name: '', email: '', photo: null };

// DOM refs
const tile = document.getElementById('account-tile');
const avatar = document.getElementById('account-avatar');
const initials = document.getElementById('account-initials');
const photo = document.getElementById('account-photo');
const nameEl = document.getElementById('account-name');
const emailEl = document.getElementById('account-email');
// Modal refs
const overlay = document.getElementById('account-modal');
const closeBtn = document.getElementById('account-modal-close');
const cancelBtn = document.getElementById('account-modal-cancel');
const saveBtn = document.getElementById('account-modal-save');
const firstNameInput = document.getElementById('profile-first-name');
const lastNameInput = document.getElementById('profile-last-name');
const emailInput = document.getElementById('profile-email');
const photoPreview = document.getElementById('profile-photo-preview');
const photoInitials = document.getElementById('profile-photo-initials');
const photoImg = document.getElementById('profile-photo-img');
const photoUploadBtn = document.getElementById('profile-photo-upload');
const photoRemoveBtn = document.getElementById('profile-photo-remove');
const photoFileInput = document.getElementById('profile-photo-input');

let tempPhoto = null;

function getInitials(first, last) {
  const f = (first || '').trim().charAt(0).toUpperCase();
  const l = (last || '').trim().charAt(0).toUpperCase();
  return f + l || '';
}

function getDisplayName(first, last) {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || 'Set up profile';
}

function updateTile() {
  const ini = getInitials(profile.first_name, profile.last_name);
  initials.textContent = ini;
  nameEl.textContent = getDisplayName(profile.first_name, profile.last_name);
  emailEl.textContent = profile.email || '';
  emailEl.style.display = profile.email ? '' : 'none';

  if (profile.photo) {
    photo.src = profile.photo;
    photo.classList.add('has-photo');
  } else {
    photo.classList.remove('has-photo');
    photo.removeAttribute('src');
  }
}

function updateModalPreview(firstName, lastName, photoSrc) {
  const ini = getInitials(firstName, lastName);
  photoInitials.textContent = ini;

  if (photoSrc) {
    photoImg.src = photoSrc;
    photoImg.classList.add('has-photo');
  } else {
    photoImg.classList.remove('has-photo');
    photoImg.removeAttribute('src');
  }
}

function openModal() {
  firstNameInput.value = profile.first_name || '';
  lastNameInput.value = profile.last_name || '';
  emailInput.value = profile.email || '';
  tempPhoto = profile.photo || null;
  updateModalPreview(profile.first_name, profile.last_name, tempPhoto);
  overlay.classList.add('open');
  // Hide the active tab view so the modal renders on top
  window.portal.hideAllTabViews();
  requestAnimationFrame(() => firstNameInput.focus());
}

function closeModal() {
  overlay.classList.remove('open');
  tempPhoto = null;
  // Restore the active tab view
  if (state.activeTabId) {
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (tab && tab.url) {
      window.portal.showTabView(state.activeTabId);
    }
  }
}

async function saveProfile() {
  const fields = {
    firstName: firstNameInput.value.trim(),
    lastName: lastNameInput.value.trim(),
    email: emailInput.value.trim(),
    photo: tempPhoto,
  };

  await window.portal.updateProfile(fields);

  profile.first_name = fields.firstName;
  profile.last_name = fields.lastName;
  profile.email = fields.email;
  profile.photo = fields.photo;

  updateTile();
  closeModal();
}

function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

export async function setupAccount() {
  // Static icons
  closeBtn.innerHTML = renderIcon(PiX, 14);

  // Load profile from DB
  const row = await window.portal.getProfile();
  if (row) {
    profile = row;
  }
  updateTile();

  // Open modal
  tile.addEventListener('click', openModal);

  // Close modal
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      closeModal();
    }
  });

  // Save
  saveBtn.addEventListener('click', saveProfile);

  // Live preview in modal
  function onInputChange() {
    updateModalPreview(firstNameInput.value, lastNameInput.value, tempPhoto);
  }
  firstNameInput.addEventListener('input', onInputChange);
  lastNameInput.addEventListener('input', onInputChange);

  // Photo upload
  photoUploadBtn.addEventListener('click', () => photoFileInput.click());
  photoFileInput.addEventListener('change', async () => {
    const file = photoFileInput.files[0];
    if (!file) return;

    // Resize to 128x128 max before storing as data URL
    const dataUrl = await readFileAsDataURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 128;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      tempPhoto = canvas.toDataURL('image/jpeg', 0.85);
      updateModalPreview(firstNameInput.value, lastNameInput.value, tempPhoto);
    };
    img.src = dataUrl;
    photoFileInput.value = '';
  });

  // Photo remove
  photoRemoveBtn.addEventListener('click', () => {
    tempPhoto = null;
    updateModalPreview(firstNameInput.value, lastNameInput.value, null);
  });

  // Enter to save
  [firstNameInput, lastNameInput, emailInput].forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveProfile();
    });
  });
}
