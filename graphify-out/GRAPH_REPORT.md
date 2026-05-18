# Graph Report - _deploy_fix_repo  (2026-05-10)

## Corpus Check
- Large corpus: 342 files · ~120,623 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder, or use --no-semantic to run AST-only.

## Summary
- 1113 nodes · 1456 edges · 141 communities (99 shown, 42 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Account & Checkout Pages|Account & Checkout Pages]]
- [[_COMMUNITY_Cart & Bundle UI|Cart & Bundle UI]]
- [[_COMMUNITY_App Layout & Routing|App Layout & Routing]]
- [[_COMMUNITY_Cart Totals & Payments|Cart Totals & Payments]]
- [[_COMMUNITY_Product & Collection Pages|Product & Collection Pages]]
- [[_COMMUNITY_Bundle Selector|Bundle Selector]]
- [[_COMMUNITY_Product Actions & Data|Product Actions & Data]]
- [[_COMMUNITY_Payment Constants|Payment Constants]]
- [[_COMMUNITY_Quick Order Flow|Quick Order Flow]]
- [[_COMMUNITY_Account Profile & Address|Account Profile & Address]]
- [[_COMMUNITY_Landing Page Builder|Landing Page Builder]]
- [[_COMMUNITY_Account Info & Customer|Account Info & Customer]]
- [[_COMMUNITY_Cart Items & Preview|Cart Items & Preview]]
- [[_COMMUNITY_Navigation & Checkout Summary|Navigation & Checkout Summary]]
- [[_COMMUNITY_Social Proof Popup|Social Proof Popup]]
- [[_COMMUNITY_Module Group 15|Module Group 15]]
- [[_COMMUNITY_Module Group 16|Module Group 16]]
- [[_COMMUNITY_Module Group 17|Module Group 17]]
- [[_COMMUNITY_Module Group 18|Module Group 18]]
- [[_COMMUNITY_Module Group 19|Module Group 19]]
- [[_COMMUNITY_Module Group 20|Module Group 20]]
- [[_COMMUNITY_Module Group 21|Module Group 21]]
- [[_COMMUNITY_Module Group 22|Module Group 22]]
- [[_COMMUNITY_Module Group 23|Module Group 23]]
- [[_COMMUNITY_Module Group 24|Module Group 24]]
- [[_COMMUNITY_Module Group 25|Module Group 25]]
- [[_COMMUNITY_Module Group 26|Module Group 26]]
- [[_COMMUNITY_Module Group 27|Module Group 27]]
- [[_COMMUNITY_Module Group 28|Module Group 28]]
- [[_COMMUNITY_Module Group 29|Module Group 29]]
- [[_COMMUNITY_Module Group 30|Module Group 30]]
- [[_COMMUNITY_Module Group 31|Module Group 31]]
- [[_COMMUNITY_Module Group 32|Module Group 32]]
- [[_COMMUNITY_Module Group 33|Module Group 33]]
- [[_COMMUNITY_Module Group 34|Module Group 34]]
- [[_COMMUNITY_Module Group 35|Module Group 35]]
- [[_COMMUNITY_Module Group 36|Module Group 36]]
- [[_COMMUNITY_Module Group 37|Module Group 37]]
- [[_COMMUNITY_Module Group 38|Module Group 38]]
- [[_COMMUNITY_Module Group 39|Module Group 39]]
- [[_COMMUNITY_Module Group 40|Module Group 40]]
- [[_COMMUNITY_Module Group 41|Module Group 41]]
- [[_COMMUNITY_Module Group 42|Module Group 42]]
- [[_COMMUNITY_Module Group 43|Module Group 43]]
- [[_COMMUNITY_Module Group 45|Module Group 45]]
- [[_COMMUNITY_Module Group 46|Module Group 46]]
- [[_COMMUNITY_Module Group 47|Module Group 47]]
- [[_COMMUNITY_Module Group 48|Module Group 48]]
- [[_COMMUNITY_Module Group 49|Module Group 49]]
- [[_COMMUNITY_Module Group 50|Module Group 50]]
- [[_COMMUNITY_Module Group 52|Module Group 52]]
- [[_COMMUNITY_Module Group 53|Module Group 53]]
- [[_COMMUNITY_Module Group 54|Module Group 54]]
- [[_COMMUNITY_Module Group 55|Module Group 55]]
- [[_COMMUNITY_Module Group 56|Module Group 56]]
- [[_COMMUNITY_Module Group 57|Module Group 57]]
- [[_COMMUNITY_Module Group 58|Module Group 58]]
- [[_COMMUNITY_Module Group 59|Module Group 59]]
- [[_COMMUNITY_Module Group 60|Module Group 60]]
- [[_COMMUNITY_Module Group 61|Module Group 61]]
- [[_COMMUNITY_Module Group 62|Module Group 62]]
- [[_COMMUNITY_Module Group 63|Module Group 63]]
- [[_COMMUNITY_Module Group 64|Module Group 64]]
- [[_COMMUNITY_Module Group 65|Module Group 65]]
- [[_COMMUNITY_Module Group 66|Module Group 66]]
- [[_COMMUNITY_Module Group 67|Module Group 67]]
- [[_COMMUNITY_Module Group 68|Module Group 68]]
- [[_COMMUNITY_Module Group 69|Module Group 69]]
- [[_COMMUNITY_Module Group 70|Module Group 70]]
- [[_COMMUNITY_Module Group 71|Module Group 71]]
- [[_COMMUNITY_Module Group 72|Module Group 72]]
- [[_COMMUNITY_Module Group 73|Module Group 73]]
- [[_COMMUNITY_Module Group 74|Module Group 74]]
- [[_COMMUNITY_Module Group 75|Module Group 75]]
- [[_COMMUNITY_Module Group 76|Module Group 76]]
- [[_COMMUNITY_Module Group 77|Module Group 77]]
- [[_COMMUNITY_Module Group 78|Module Group 78]]
- [[_COMMUNITY_Module Group 79|Module Group 79]]
- [[_COMMUNITY_Module Group 80|Module Group 80]]
- [[_COMMUNITY_Module Group 81|Module Group 81]]
- [[_COMMUNITY_Module Group 87|Module Group 87]]
- [[_COMMUNITY_Module Group 88|Module Group 88]]
- [[_COMMUNITY_Module Group 137|Module Group 137]]

## God Nodes (most connected - your core abstractions)
1. `useLocaleCopy()` - 56 edges
2. `convertToLocale()` - 22 edges
3. `getRegion` - 20 edges
4. `getAuthHeaders()` - 18 edges
5. `getCopy()` - 17 edges
6. `localeFromCountryCode()` - 16 edges
7. `SepayPaymentProvider` - 13 edges
8. `test` - 11 edges
9. `BasePage` - 11 edges
10. `sdk` - 11 edges

## Surprising Connections (you probably didn't know these)
- `ProfileBillingAddress()` --calls--> `useLocaleCopy()`  [EXTRACTED]
  storefront/src/modules/account/components/profile-billing-address/index.tsx → storefront/src/lib/locale-context.tsx
- `ProfileEmail()` --calls--> `useLocaleCopy()`  [EXTRACTED]
  storefront/src/modules/account/components/profile-email/index.tsx → storefront/src/lib/locale-context.tsx
- `ProfileName()` --calls--> `useLocaleCopy()`  [EXTRACTED]
  storefront/src/modules/account/components/profile-name/index.tsx → storefront/src/lib/locale-context.tsx
- `ProfileEmail()` --calls--> `useLocaleCopy()`  [EXTRACTED]
  storefront/src/modules/account/components/profile-phone/index.tsx → storefront/src/lib/locale-context.tsx
- `BillingAddress()` --calls--> `useLocaleCopy()`  [EXTRACTED]
  storefront/src/modules/checkout/components/billing_address/index.tsx → storefront/src/lib/locale-context.tsx

## Communities (141 total, 42 thin omitted)

### Community 0 - "Account & Checkout Pages"
Cohesion: 0.05
Nodes (50): AccountPageLayout(), Addresses(), metadata, CategoryPage(), generateMetadata(), generateStaticParams(), Props, metadata (+42 more)

### Community 1 - "Cart & Bundle UI"
Cohesion: 0.05
Nodes (18): BasePage, CartDropdown, NavMenu, SearchModal, createTemplateDatabase(), createTestDatabase(), dropTemplate(), getDatabaseClient() (+10 more)

### Community 2 - "App Layout & Routing"
Cohesion: 0.05
Nodes (16): AccountPage, AddressesPage, accountFixtures, LoginPage, OrderPage, OrdersPage, OverviewPage, ProfilePage (+8 more)

### Community 3 - "Cart Totals & Payments"
Cohesion: 0.06
Nodes (38): ComboBundle(), ComboItem, formatVND(), getPrice(), Props, addToCart(), deleteLineItem(), ensurePaymentSession() (+30 more)

### Community 4 - "Product & Collection Pages"
Cohesion: 0.06
Nodes (28): CartTotals(), CartTotalsProps, getProductsById, LineItemPrice(), LineItemPriceProps, LineItemUnitPrice(), LineItemUnitPriceProps, OrderCard() (+20 more)

### Community 5 - "Bundle Selector"
Cohesion: 0.07
Nodes (25): beVietnamPro, metadata, POST(), CheckoutLayout(), getStoreMetadata(), Footer(), copy, getCopy() (+17 more)

### Community 6 - "Product Actions & Data"
Cohesion: 0.07
Nodes (31): providerExport, services, COOKIE_SECRET, DATABASE_URL, JWT_SECRET, getPancakeCommuneId(), getPancakeProvinceId(), PROVINCE_CODE_MAP (+23 more)

### Community 7 - "Payment Constants"
Cohesion: 0.12
Nodes (18): getOrInitAxios(), loadRegion(), loginAdmin(), region, seedData(), seedDiscount(), seedGiftcard(), seedUser() (+10 more)

### Community 8 - "Quick Order Flow"
Cohesion: 0.08
Nodes (16): BundleOption, GiftItem, Props, VariantBundleConfig, fbq(), loadFbScript(), Window, fireCustomEvent() (+8 more)

### Community 9 - "Account Profile & Address"
Cohesion: 0.11
Nodes (21): CartButton(), fetchCart(), CartDropdown(), fmtVND(), Cart(), fetchCart(), metadata, CheckoutForm() (+13 more)

### Community 10 - "Landing Page Builder"
Cohesion: 0.09
Nodes (16): isManual(), isPaypal(), isStripe(), noDivisionCurrencies, paymentInfoMap, PaymentButton(), PaymentButtonProps, PaymentContainer() (+8 more)

### Community 11 - "Account Info & Customer"
Cohesion: 0.07
Nodes (18): blocks, BuilderBlock, CATEGORIES, Props, SECTION_TIPS, Benefit, BundleOptionMeta, config (+10 more)

### Community 12 - "Cart Items & Preview"
Cohesion: 0.13
Nodes (13): AccountNav(), AccountNavLinkProps, CheckoutSummary(), EmptyCartMessage(), useLocaleCopy(), Login(), Props, getProfileCompletion() (+5 more)

### Community 13 - "Navigation & Checkout Summary"
Cohesion: 0.13
Nodes (10): AddressState, BundleOpt, CheckoutMethod, ensurePaymentSession(), formatVND(), Props, QuickOrder(), retrieveCart() (+2 more)

### Community 14 - "Social Proof Popup"
Cohesion: 0.12
Nodes (6): providerExport, services, InjectedDependencies, MinioFileProviderOptions, MinioFileProviderService, MinioServiceConfig

### Community 15 - "Module Group 15"
Cohesion: 0.17
Nodes (10): ALLOWED_ATTRS, ALLOWED_TAGS, extractHtml(), parseGrapesContent(), ProductPageContent(), Props, CustomPage(), generateMetadata() (+2 more)

### Community 17 - "Module Group 17"
Cohesion: 0.14
Nodes (9): AccountInfoProps, updateCustomer, MyInformationProps, ProfileEmail(), MyInformationProps, ProfileName(), MyInformationProps, MyInformationProps (+1 more)

### Community 18 - "Module Group 18"
Cohesion: 0.15
Nodes (10): AccountInfo(), Addresses(), CountryOption, CountrySelectProps, StateType, useToggleState(), SideMenu(), SideMenuExtra (+2 more)

### Community 19 - "Module Group 19"
Cohesion: 0.14
Nodes (9): AddressBookProps, AddAddress(), EditAddress(), EditAddressProps, addCustomerAddress(), deleteCustomerAddress(), updateCustomerAddress(), MyInformationProps (+1 more)

### Community 20 - "Module Group 20"
Cohesion: 0.14
Nodes (8): Items(), ItemsProps, SkeletonCartPage(), SkeletonProductGrid(), SkeletonRelatedProducts(), ItemsPreviewTemplate(), ItemsTemplateProps, repeat()

### Community 21 - "Module Group 21"
Cohesion: 0.18
Nodes (12): AVATARS, CITIES, DEFAULT_PRODUCTS, FIRST_NAMES, generateNotification(), LAST_NAMES, MIDDLE_NAMES, Notification (+4 more)

### Community 22 - "Module Group 22"
Cohesion: 0.2
Nodes (6): ModalContext, ModalProvider(), ModalProviderProps, useModal(), ModalProps, Title()

### Community 23 - "Module Group 23"
Cohesion: 0.18
Nodes (6): useIntersection(), ProductActions(), ProductActionsProps, MobileActions(), MobileActionsProps, OptionSelectProps

### Community 24 - "Module Group 24"
Cohesion: 0.21
Nodes (11): AVATARS, CITIES, FIRST_NAMES, formatVND(), genName(), LAST_NAMES, MIDDLE_NAMES, Props (+3 more)

### Community 25 - "Module Group 25"
Cohesion: 0.26
Nodes (8): BenefitsSection(), FAQSection(), meta(), PainSolutionSection(), ProductTemplate(), Props, ReviewsSection(), SpecsSection()

### Community 26 - "Module Group 26"
Cohesion: 0.18
Nodes (3): AccordionItemProps, AccordionProps, ProductTabsProps

### Community 27 - "Module Group 27"
Cohesion: 0.2
Nodes (6): searchClient, metadata, Params, SearchResults(), Hits, search()

### Community 28 - "Module Group 28"
Cohesion: 0.29
Nodes (5): applyPromotions(), submitPromotionForm(), DiscountCode(), DiscountCodeProps, SubmitButton()

### Community 29 - "Module Group 29"
Cohesion: 0.22
Nodes (4): AddressSelectProps, BillingAddress(), CountrySelect(), ShippingAddress()

### Community 30 - "Module Group 30"
Cohesion: 0.25
Nodes (3): HitProps, ProductHit, HitsProps

### Community 31 - "Module Group 31"
Cohesion: 0.29
Nodes (3): getCheckoutStep(), Summary(), SummaryProps

### Community 32 - "Module Group 32"
Cohesion: 0.25
Nodes (3): DEFAULT_REVIEWS, GRADIENTS, Review

### Community 33 - "Module Group 33"
Cohesion: 0.29
Nodes (4): c, requiredEnvs, checkEnvVariables, nextConfig

### Community 34 - "Module Group 34"
Cohesion: 0.33
Nodes (4): RefinementListProps, SortOptions, SortProducts(), SortProductsProps

### Community 35 - "Module Group 35"
Cohesion: 0.33
Nodes (3): ControlledSearchBoxProps, SearchBoxProps, SearchBoxWrapper()

### Community 37 - "Module Group 37"
Cohesion: 0.33
Nodes (5): envPath, { execSync }, fs, MEDUSA_SERVER_PATH, path

### Community 38 - "Module Group 38"
Cohesion: 0.33
Nodes (5): child, fs, medusaServerPath, path, { spawn }

### Community 39 - "Module Group 39"
Cohesion: 0.47
Nodes (5): config, getCountryCode(), getRegionMap(), middleware(), regionMapCache

### Community 40 - "Module Group 40"
Cohesion: 0.7
Nodes (4): GET(), getDateMinusMinutes(), logSePayRouteError(), POST()

### Community 42 - "Module Group 42"
Cohesion: 0.4
Nodes (3): Message, Props, QUICK_REPLIES

### Community 45 - "Module Group 45"
Cohesion: 0.67
Nodes (3): ALLOWED_METADATA_KEYS, isPlainObject(), POST()

## Knowledge Gaps
- **229 isolated node(s):** `medusaConfig`, `Props`, `BuilderBlock`, `blocks`, `SECTION_TIPS` (+224 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **42 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useLocaleCopy()` connect `Cart Items & Preview` to `Module Group 34`, `Cart Totals & Payments`, `Product & Collection Pages`, `Bundle Selector`, `Module Group 35`, `Landing Page Builder`, `Module Group 17`, `Module Group 18`, `Module Group 19`, `Module Group 23`, `Module Group 28`, `Module Group 29`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `addToCart()` connect `Cart Totals & Payments` to `Quick Order Flow`, `Module Group 24`, `Module Group 23`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Why does `getRegion` connect `Account & Checkout Pages` to `Cart Totals & Payments`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `medusaConfig`, `Props`, `BuilderBlock` to the rest of the system?**
  _229 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Account & Checkout Pages` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Cart & Bundle UI` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `App Layout & Routing` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._