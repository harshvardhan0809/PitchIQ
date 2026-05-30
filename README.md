# ⚽ PitchIQ

### Premier League Player Analytics & Performance Intelligence Platform

PitchIQ is a full-stack football analytics platform that transforms raw football statistics into actionable player insights. Built with React, Vite, and Node.js, the platform enables users to explore player performance, analyze upcoming fixtures, and evaluate scoring potential through a clean, modern dashboard experience.

---

## 🌐 Live Demo

**Frontend:**
https://pitchiq-1.onrender.com

**Backend API:**
https://pitchiq-bqrr.onrender.com/api/health

---

## 📌 Overview

Modern football analysis often requires navigating multiple sources of information to understand a player's form, performance trends, and upcoming opportunities.

PitchIQ consolidates these insights into a single platform, allowing users to:

* Search Premier League players instantly
* View detailed player performance metrics
* Analyze upcoming fixtures
* Evaluate recent form and consistency
* Access data-driven scoring predictions
* Explore football insights through an intuitive dashboard

---

## ✨ Features

### 🔍 Intelligent Player Search

Quickly discover Premier League players through a responsive search interface powered by live football data.

### 📊 Player Performance Dashboard

Analyze key metrics including:

* Goals
* Assists
* Appearances
* Minutes Played
* Team Information
* Recent Form

### 📅 Upcoming Fixtures

View a player's next scheduled matches and understand upcoming opportunities and challenges.

### 🎯 Prediction Insights

Evaluate a player's scoring likelihood using performance-based indicators and fixture context.

### ⚡ Live Data Integration

Real-time football statistics are retrieved through a backend API layer, ensuring up-to-date information.

### 📱 Responsive Experience

Optimized for desktop, tablet, and mobile devices.

---

## 🏗 Architecture

```text
┌─────────────────┐
│  React Frontend │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Node.js Backend │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Football Data   │
│ API Provider    │
└─────────────────┘
```

The frontend is deployed as a static application while the backend acts as a secure proxy layer for football data requests.

---

## 🛠 Tech Stack

### Frontend

* React 19
* Vite
* JavaScript (ES6+)
* Modern CSS

### Backend

* Node.js
* REST API Architecture
* Native HTTP Server

### Infrastructure

* Render Static Site
* Render Web Service

### Data Sources

* Football Data API

---

## 🚀 Key Engineering Challenges Solved

### Full-Stack Deployment

Configured independent frontend and backend deployments while maintaining seamless communication between services.

### API Proxy Architecture

Protected API credentials by routing requests through a backend layer instead of exposing keys on the client side.

### Environment Configuration

Implemented environment-specific configurations for development and production deployments.

### Cross-Origin Resource Handling

Resolved deployment-related routing, asset-loading, and API communication challenges across multiple services.

### Live Data Integration

Designed a system capable of switching between demo and live data modes for development flexibility.

---

## 🔮 Future Roadmap

* Multi-League Support
* Player Comparison Engine
* Advanced Predictive Analytics
* Interactive Data Visualizations
* Team Analytics Dashboard
* Fantasy Premier League Integration
* Historical Trend Analysis
* User Accounts & Watchlists

---

## 💡 Why PitchIQ?

PitchIQ was built to explore how modern web technologies can be combined with sports analytics to create meaningful, data-driven experiences for football fans, analysts, and fantasy sports enthusiasts.

The project demonstrates full-stack development, API integration, deployment architecture, and real-world problem solving within a sports technology context.

---

## 👨‍💻 Author

**Harshvardhan Dhankhar**

GitHub:
https://github.com/harshvardhan0809

---

## ⭐ Support

If you found this project interesting, consider giving it a star and sharing feedback.
