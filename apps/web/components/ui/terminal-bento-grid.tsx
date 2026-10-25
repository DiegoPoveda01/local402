import React from 'react';

const BentoItem = ({ className, children }: { className?: string; children?: React.ReactNode }) => {
    return (
        <div className={`bento-item ${className ?? ""}`}>
            {children}
        </div>
    );
};

export default BentoItem;