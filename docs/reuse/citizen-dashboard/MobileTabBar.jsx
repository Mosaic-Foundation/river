import React from 'react';
import { ToolsIcon, FeedIcon, HubsIcon } from './Icons';

export function MobileTabBar({ activeTab, onTabChange }) {
  const tabs = [
    { id: 'feed', label: 'Feed', icon: FeedIcon },
    { id: 'hubs', label: 'Hubs', icon: HubsIcon },
    { id: 'info', label: 'Info & Tools', icon: ToolsIcon },
  ];

  return (
    <nav className="mobile-tab-bar">
      <div className="mobile-tab-bar-inner">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`mobile-tab ${activeTab === tab.id ? 'active' : ''}`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              <Icon size={24} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
